import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { workspaceOf } from '../../lightrag/data/workspace';
import { ISourceGateway } from '../domain/source.gateway';
import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
  ISourceIndexOutcome,
} from '../domain/source.types';
import { SourceMapper } from './source.mapper';

// LightRAG processes ingested documents in a background pipeline. These bound
// how long one index run waits for that pipeline before giving up and marking
// the remaining sources as not indexed (so the next run retries them).
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const PROCESSING_POLL_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class SourceGateway extends ISourceGateway {
  private readonly logger = new Logger(SourceGateway.name);
  private lastLoggedBucket = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: SourceMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
  ) {
    super();
  }

  /**
   * Keys live under a shared `knowledges/` prefix, mirroring the
   * `agents/{agent-id}` layout, so the knowledge bucket can be shared with
   * agent data without either scattering folders across the bucket root.
   */
  private static keyFor(knowledgeId: string, filename: string): string {
    return `knowledges/${knowledgeId}/${crypto.randomUUID()}-${filename}`;
  }

  private async requireBucket(): Promise<string> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.bucket) {
      this.logger.error(
        'knowledge/s3_bucket is not set — cannot upload source files',
      );
      throw new ServiceUnavailableException(
        'Knowledge S3 bucket is not configured',
      );
    }
    // Only on change, so a busy import doesn't repeat one constant per file.
    // Worth logging at all because this bucket comes from knowledge/s3_bucket
    // while its region/endpoint come from the integrations/* group - the two
    // are edited on different settings pages and drift apart easily.
    if (cfg.bucket !== this.lastLoggedBucket) {
      this.logger.log(`knowledge sources bucket resolved: ${cfg.bucket}`);
      this.lastLoggedBucket = cfg.bucket;
    }
    return cfg.bucket;
  }

  async findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ISourceData | null> {
    const record = await this.prisma.source.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateSourceData): Promise<ISourceData> {
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: data.knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${data.knowledgeId} not found`);
    }
    const record = await this.prisma.source.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  /**
   * Bulk insert. Used by the sitemap importer where N sequential round
   * trips to a remote Postgres (Neon, us-east-1) would otherwise blow past
   * any reasonable HTTP timeout. All items must belong to the same
   * knowledge - the existence check runs once for that knowledge. The
   * caller only ever needs the count back, so we skip the re-fetch that a
   * full ISourceData[] would require.
   */
  async createMany(data: ICreateSourceData[]): Promise<ISourceData[]> {
    if (data.length === 0) return [];
    const knowledgeId = data[0].knowledgeId;
    if (!data.every((d) => d.knowledgeId === knowledgeId)) {
      throw new BadRequestException(
        'createMany requires all items to share the same knowledgeId',
      );
    }
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${knowledgeId} not found`);
    }
    const rows = data.map((d) => this.mapper.toCreate(d));
    await this.prisma.source.createMany({ data: rows });
    return [];
  }

  async delete(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } });
  }

  async uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    const stored = await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async uploadFileStream(
    input: IUploadSourceStreamInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    // S3Repository uploads buffers via PutObject; the custom/MinIO endpoint
    // doesn't accept unbounded streaming bodies. Archive entries are
    // processed one at a time, so materializing a single entry keeps peak
    // memory bounded to that one file - the same profile as uploadFile.
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new BadRequestException(
          'archive entry stream emitted a non-binary chunk',
        );
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const stored = await this.s3.upload({
      bucket,
      key,
      body: Buffer.concat(chunks),
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async deleteFile(url: string): Promise<void> {
    const location = S3Repository.parseUri(url);
    await this.s3.delete(location);
  }

  /**
   * Ingest only enqueues: LightRAG hands back a track id and builds chunks,
   * embeddings and the graph in a background pipeline afterwards. Storing that
   * track id as proof of indexing is what let a knowledge base report `ready`
   * while its graph stayed empty and every query came back without context.
   *
   * So submit everything first, then wait for the pipeline to reach a terminal
   * state, and persist a doc id only for documents LightRAG reports as
   * processed. Anything that fails or never finishes keeps `lightragDocId`
   * null, which leaves `indexed` false so the next run retries it. Re-ingest
   * is safe: LightRAG addresses documents by content hash, so resubmitting the
   * same source converges on the same document instead of duplicating it.
   */
  async indexSources(sources: ISourceData[]): Promise<ISourceIndexOutcome[]> {
    const outcomes = new Map<string, ISourceIndexOutcome>();
    const inFlight = new Map<string, ISourceData>();

    for (const source of sources) {
      const settled = await this.settleAlreadyIndexed(source);
      if (settled) {
        outcomes.set(source.id, settled);
        continue;
      }
      try {
        const workspace = workspaceOf(source.knowledgeId);
        const trackId = await this.ingestByType(source, workspace);
        inFlight.set(trackId, source);
      } catch (err) {
        outcomes.set(source.id, this.failed(source, errorMessage(err)));
      }
    }

    await this.awaitProcessing(inFlight, outcomes);

    return sources.map(
      (s) =>
        outcomes.get(s.id) ??
        this.failed(s, 'LightRAG reported no state for this document'),
    );
  }

  private failed(source: ISourceData, error: string): ISourceIndexOutcome {
    return { sourceId: source.id, name: source.name, indexed: false, error };
  }

  /**
   * A source already carrying a doc id is only trusted if LightRAG still
   * reports that document as processed. Otherwise the claim is dropped so the
   * caller re-ingests. This is what unsticks bases indexed before the pipeline
   * was actually checked: they look indexed but LightRAG has nothing.
   */
  private async settleAlreadyIndexed(
    source: ISourceData,
  ): Promise<ISourceIndexOutcome | null> {
    if (!source.indexed) return null;

    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    const trackId = record?.lightragDocId ?? null;
    if (trackId === null) return null;

    try {
      const status = await this.lightrag.getTrackStatus(trackId);
      const processed =
        status.documents.length > 0 &&
        status.documents.every((d) => d.status === 'processed');
      if (processed) {
        return {
          sourceId: source.id,
          name: source.name,
          indexed: true,
          error: null,
        };
      }
    } catch (err) {
      // Cannot tell either way, so keep the existing claim and report the
      // source as unverified for this run rather than re-ingesting blindly.
      return this.failed(source, errorMessage(err));
    }

    await this.prisma.source.update({
      where: { id: source.id },
      data: { lightragDocId: null },
    });
    return null;
  }

  private async awaitProcessing(
    inFlight: Map<string, ISourceData>,
    outcomes: Map<string, ISourceIndexOutcome>,
  ): Promise<void> {
    if (inFlight.size === 0) return;

    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;

    while (inFlight.size > 0 && Date.now() < deadline) {
      await sleep(PROCESSING_POLL_INTERVAL_MS);

      for (const [trackId, source] of [...inFlight]) {
        try {
          const status = await this.lightrag.getTrackStatus(trackId);
          if (status.documents.length === 0) continue;

          const failure = status.documents.find((d) => d.status === 'failed');
          if (failure) {
            inFlight.delete(trackId);
            outcomes.set(
              source.id,
              this.failed(
                source,
                failure.errorMessage ?? 'LightRAG failed to process it',
              ),
            );
            continue;
          }

          if (status.documents.every((d) => d.status === 'processed')) {
            inFlight.delete(trackId);
            await this.prisma.source.update({
              where: { id: source.id },
              data: { lightragDocId: trackId },
            });
            outcomes.set(source.id, {
              sourceId: source.id,
              name: source.name,
              indexed: true,
              error: null,
            });
          }
        } catch (err) {
          // Transient read failure. Leave it in flight and retry next tick;
          // the deadline is what stops an endlessly unreachable LightRAG.
          this.logger.warn(
            `track_status(${trackId}) failed: ${errorMessage(err)}`,
          );
        }
      }
    }

    const timeoutSeconds = Math.round(PROCESSING_TIMEOUT_MS / 1000);
    for (const source of inFlight.values()) {
      outcomes.set(
        source.id,
        this.failed(
          source,
          `still processing after ${timeoutSeconds}s - will retry on the next index run`,
        ),
      );
    }
  }

  async removeFromIndex(source: ISourceData): Promise<void> {
    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    if (!record?.lightragDocId) return;
    await this.lightrag.deleteDocumentsByTrackIds([record.lightragDocId]);
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId, lightragDocId: { not: null } },
      select: { lightragDocId: true },
    });
    const trackIds = records
      .map((r) => r.lightragDocId)
      .filter((v): v is string => v !== null);
    if (trackIds.length === 0) return;
    await this.lightrag.deleteDocumentsByTrackIds(trackIds);
  }

  private async ingestByType(
    source: ISourceData,
    workspace: string,
  ): Promise<string> {
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.lightrag.ingestText({
        workspace,
        text: source.content,
        fileSource: source.name,
      });
      return res.docId;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.lightrag.ingestUrl({
        workspace,
        url: source.url,
      });
      return res.docId;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const location = S3Repository.parseUri(source.url);
      const buffer = await this.s3.download(location);
      const res = await this.lightrag.ingestFile({
        workspace,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      return res.docId;
    }
    const exhaustive: never = source.type;
    throw new Error(`Unknown source type: ${String(exhaustive)}`);
  }
}

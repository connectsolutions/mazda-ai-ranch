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
import { DocumentProcessingStatusTypes } from '../../lightrag/domain/lightrag.types';
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

type IExistingIndexCheck =
  | { kind: 'indexed' }
  | { kind: 'inFlight'; trackId: string }
  | { kind: 'stale' }
  | { kind: 'unknown'; error: string };

// "Identical content already exists under another filename. Original doc_id:
// doc-abc123, Status: processed" - only worth adopting when that original is
// itself processed; a failed original has nothing to offer.
// Deliberately lenient about the id itself: a stricter pattern would silently
// stop adopting the day LightRAG changes its id format, putting the duplicate
// loop back.
const DUPLICATE_OF = /Original doc_id:\s*(\S+?),?\s*Status:\s*(\w+)/i;

function adoptableDocId(message: string | null): string | null {
  if (message === null) return null;
  const match = DUPLICATE_OF.exec(message);
  if (match === null) return null;
  return match[2].toLowerCase() === 'processed' ? match[1] : null;
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

    // One snapshot of everything LightRAG holds, so a document we only know by
    // doc id (adopted from a duplicate rejection) can still be resolved.
    const known = await this.snapshotDocuments();

    for (const source of sources) {
      const existing = await this.checkExistingIndex(source, known);

      if (existing.kind === 'indexed') {
        outcomes.set(source.id, this.indexed(source));
        continue;
      }
      if (existing.kind === 'inFlight') {
        // Already moving through the pipeline. Re-uploading here is what made
        // LightRAG answer 409 "Document storage already contains ..." for
        // every source when an index run overlapped a reprocess.
        inFlight.set(existing.trackId, source);
        continue;
      }
      if (existing.kind === 'unknown') {
        outcomes.set(source.id, this.failed(source, existing.error));
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

  private indexed(source: ISourceData): ISourceIndexOutcome {
    return {
      sourceId: source.id,
      name: source.name,
      indexed: true,
      error: null,
    };
  }

  private async snapshotDocuments(): Promise<
    Map<string, DocumentProcessingStatusTypes>
  > {
    try {
      return await this.lightrag.listDocumentStatuses();
    } catch (err) {
      // Not fatal: the per-source track lookups below still work, the snapshot
      // only helps for adopted doc ids.
      this.logger.warn(`listDocumentStatuses failed: ${errorMessage(err)}`);
      return new Map();
    }
  }

  /**
   * Classifies what LightRAG currently knows about a source that claims to be
   * indexed. The distinction that matters is between "gone or failed" (re-send
   * it) and "still in the pipeline" (wait for it) - conflating the two made an
   * index run fight an in-progress reprocess.
   */
  private async checkExistingIndex(
    source: ISourceData,
    known: Map<string, DocumentProcessingStatusTypes>,
  ): Promise<IExistingIndexCheck> {
    if (!source.indexed) return { kind: 'stale' };

    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    const storedId = record?.lightragDocId ?? null;
    if (storedId === null) return { kind: 'stale' };

    try {
      const status = await this.lightrag.getTrackStatus(storedId);
      const statuses =
        status.documents.length > 0
          ? status.documents.map((d) => d.status)
          : // Not a track id LightRAG knows. It may be a doc id adopted from a
            // duplicate rejection, so fall back to the snapshot.
            this.statusesFromSnapshot(storedId, known);

      if (statuses.length === 0) {
        await this.forgetDocId(source.id);
        return { kind: 'stale' };
      }
      if (statuses.every((s) => s === 'processed')) return { kind: 'indexed' };
      if (statuses.some((s) => s === 'pending' || s === 'processing')) {
        return { kind: 'inFlight', trackId: storedId };
      }
    } catch (err) {
      // Cannot tell either way, so keep the existing claim and report the
      // source as unverified for this run rather than re-ingesting blindly.
      return { kind: 'unknown', error: errorMessage(err) };
    }

    // Failed, or a state we do not treat as in flight: drop the claim so this
    // run re-sends it.
    await this.forgetDocId(source.id);
    return { kind: 'stale' };
  }

  private statusesFromSnapshot(
    docId: string,
    known: Map<string, DocumentProcessingStatusTypes>,
  ): DocumentProcessingStatusTypes[] {
    const status = known.get(docId);
    return status ? [status] : [];
  }

  private async forgetDocId(sourceId: string): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { lightragDocId: null },
    });
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

            // LightRAG deduplicates by content hash. When the same text is
            // already stored under another filename it refuses the upload and
            // names the original. If that original is processed the content is
            // searchable, so adopt its id rather than reporting a failure the
            // next run would only reproduce.
            const adopted = adoptableDocId(failure.errorMessage);
            if (adopted !== null) {
              await this.prisma.source.update({
                where: { id: source.id },
                data: { lightragDocId: adopted },
              });
              outcomes.set(source.id, this.indexed(source));
              continue;
            }

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

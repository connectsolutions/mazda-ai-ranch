import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IKnowledgeGateway } from './knowledge.gateway';
import {
  IKnowledgeData,
  IKnowledgeRecord,
  ICreateKnowledgeData,
  IndexStatusTypes,
  IUpdateKnowledgeData,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { staleIndexAfterMs } from '../../source/domain/indexBudget';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NO_SOURCES = { total: 0, indexed: 0, failed: 0 };

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IKnowledgeGateway,
    private readonly sources: SourceService,
  ) {}

  async list(): Promise<IKnowledgeData[]> {
    const records = await this.gateway.findAll();
    return this.withCounts(records);
  }

  async get(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    const [withCounts] = await this.withCounts([k]);
    return withCounts;
  }

  async create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const created = await this.gateway.create(data);
    // Fresh row, nothing attached yet: no point in a round trip for zeros.
    return this.attachCounts(created, NO_SOURCES);
  }

  async update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    await this.requireRecord(id);
    const updated = await this.gateway.update(id, data);
    const [withCounts] = await this.withCounts([updated]);
    return withCounts;
  }

  /** Existence check without the counts round trip that get() adds. */
  private async requireRecord(id: string): Promise<IKnowledgeRecord> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  /**
   * Source progress is owned by the source slice; ask it once for the whole
   * batch so listing N knowledges costs one round of counts, not N.
   */
  private async withCounts(
    records: IKnowledgeRecord[],
  ): Promise<IKnowledgeData[]> {
    if (records.length === 0) return [];
    const counts = await this.sources.countByKnowledgeIds(
      records.map((r) => r.id),
    );
    return records.map((r) =>
      this.attachCounts(r, counts.get(r.id) ?? NO_SOURCES),
    );
  }

  private attachCounts(
    record: IKnowledgeRecord,
    counts: { total: number; indexed: number; failed: number },
  ): IKnowledgeData {
    return {
      ...record,
      sourceCount: counts.total,
      indexedCount: counts.indexed,
      failedCount: counts.failed,
    };
  }

  async delete(id: string): Promise<void> {
    await this.requireRecord(id);
    try {
      await this.sources.removeAllByKnowledge(id);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${id}) failed: ${errorMessage(err)}`,
      );
    }
    await this.gateway.delete(id);
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.requireRecord(knowledgeId);

    if (k.indexStatus === 'indexing' && k.indexStartedAt) {
      const ageMs = Date.now() - k.indexStartedAt.getTime();
      // Scaled to the base's size: a run over 200 documents legitimately takes
      // far longer than one over a handful, and offering a restart while the
      // first run is still waiting would set two runs fighting over the same
      // sources.
      const sources = await this.sources.findByKnowledge(knowledgeId);
      if (ageMs < staleIndexAfterMs(sources.length)) {
        throw new Error(
          `Knowledge ${knowledgeId} already indexing (started ${Math.round(ageMs / 1000)}s ago)`,
        );
      }
      this.logger.warn(
        `Knowledge ${knowledgeId} has stale indexing state — restarting`,
      );
    }

    await this.gateway.updateIndexState(knowledgeId, {
      indexStatus: 'indexing',
      indexStartedAt: new Date(),
      indexError: null,
    });

    const task = this.runIndex(knowledgeId);
    this.inflightIndexing.set(knowledgeId, task);
    void task.finally(() => {
      if (this.inflightIndexing.get(knowledgeId) === task) {
        this.inflightIndexing.delete(knowledgeId);
      }
    });
  }

  async waitForIndex(knowledgeId: string): Promise<void> {
    const task = this.inflightIndexing.get(knowledgeId);
    if (task) await task;
  }

  async query(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    await this.requireRecord(knowledgeId);
    return this.gateway.searchKnowledge(knowledgeId, query, mode, topK);
  }

  getGraphLabels(): Promise<string[]> {
    return this.gateway.getGraphLabels();
  }

  getGraph(params: IGetGraphParams): Promise<IGraphData> {
    return this.gateway.getGraph(params);
  }

  private async runIndex(knowledgeId: string): Promise<void> {
    try {
      const sources = await this.sources.findByKnowledge(knowledgeId);
      // Every source goes through the gateway on every run, including ones
      // already marked indexed: the gateway re-checks them against LightRAG
      // and re-ingests anything the pipeline never actually processed. That is
      // what makes the Index button a real retry instead of a no-op.
      const outcomes = await this.sources.indexSources(sources);

      const failures = outcomes.filter((o) => !o.indexed);
      for (const failure of failures) {
        this.logger.warn(
          `indexing failed for ${failure.sourceId} (${failure.name}): ${failure.error ?? 'unknown error'}`,
        );
      }

      const summary =
        failures.length === 0
          ? null
          : `${failures.length} source(s) failed: ${failures
              .slice(0, 5)
              .map((f) => `${f.name} (${f.error ?? 'unknown error'})`)
              .join('; ')}${failures.length > 5 ? '; ...' : ''}`;
      const indexedCount = outcomes.length - failures.length;
      // 'ready' means LightRAG confirmed at least one document as processed,
      // or the base is empty (nothing to do is trivially ready). Accepting an
      // upload is not enough: that is what used to show `ready` on a base with
      // an empty graph that answered every query with no context.
      const status: IndexStatusTypes =
        indexedCount > 0 || sources.length === 0 ? 'ready' : 'failed';
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: status,
        // Bump indexedAt only when something is actually searchable now.
        // Preserves the timestamp of the last successful run when the
        // current run failed everything but earlier runs had succeeded.
        indexedAt: indexedCount > 0 ? new Date() : undefined,
        indexError: summary,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${errorMessage(err)}`,
      );
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: errorMessage(err),
      });
    }
  }
}

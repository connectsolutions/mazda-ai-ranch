// How long an index run may wait for LightRAG's background pipeline. Neither a
// flat timeout nor a per-document one survives contact with real documents:
// the pipeline runs an LLM over every *chunk*, and chunk count follows the
// length of the text, not the number of files. Measured against the dev
// cluster (Haiku on Bedrock, 4-way LLM concurrency): a 1 MB markdown owner's
// manual splits into 217 chunks and spends about 20 minutes in extraction
// alone, while a 3 KB order form is a single chunk and lands in under a
// minute. A per-document constant sized for the second calls the first stalled
// after 30 seconds, which is exactly what a 145-file documentation set hit -
// the run reported "still processing" on documents that were merely large.
const BASE_BUDGET_MS = 5 * 60 * 1000;

// Per-document overhead that does not scale with length: the upload, the queue
// wait behind other documents, and the merge pass LightRAG runs once per
// document however short it is.
const PER_DOCUMENT_BUDGET_MS = 30 * 1000;

// The volume term. Measured end to end on one 1 MB manual: ~20 minutes of
// chunk extraction plus a merge pass over the entities it produced that ran
// just as long again. Both scale with chunk count, so both belong here.
// Calibrated at 4-way LLM concurrency, which is what the dev instance actually
// runs; raising that concurrency should lower this number.
const PER_MEGABYTE_BUDGET_MS = 45 * 60 * 1000;

const MAX_BUDGET_MS = 4 * 60 * 60 * 1000;
const BYTES_PER_MEGABYTE = 1024 * 1024;

// The watchdog that lets an operator restart a run stuck in `indexing` must
// always trail the run's own budget, or the UI would offer a restart while the
// first run is still legitimately waiting, and two runs would fight.
const WATCHDOG_MARGIN_MS = 5 * 60 * 1000;

/**
 * A document as the budget sees it. `ISourceData` satisfies this structurally,
 * so callers pass their sources straight through.
 */
export interface IIndexBudgetDocument {
  /**
   * Uncompressed length. Null for sources whose size is not known before
   * ingest (url sources fetch their text at index time); those fall back to
   * the per-document term alone.
   */
  sizeBytes: number | null;
}

/**
 * Time to allow LightRAG for `documents` before giving up and reporting them
 * retryable.
 */
export function indexBudgetMs(
  documents: readonly IIndexBudgetDocument[],
): number {
  const totalBytes = documents.reduce(
    (sum, doc) => sum + Math.max(0, doc.sizeBytes ?? 0),
    0,
  );
  const budget =
    BASE_BUDGET_MS +
    documents.length * PER_DOCUMENT_BUDGET_MS +
    (totalBytes / BYTES_PER_MEGABYTE) * PER_MEGABYTE_BUDGET_MS;
  return Math.min(Math.round(budget), MAX_BUDGET_MS);
}

/**
 * Age at which an `indexing` state is treated as abandoned rather than slow.
 */
export function staleIndexAfterMs(
  documents: readonly IIndexBudgetDocument[],
): number {
  return indexBudgetMs(documents) + WATCHDOG_MARGIN_MS;
}

// How long an index run may wait for LightRAG's background pipeline. A flat
// timeout cannot work here: the pipeline runs an LLM over every document, so a
// 200-document base legitimately takes about an hour while a single source
// takes seconds. A constant short enough for the small case reports the big
// case as failed even when it is merely slow, which is exactly what a 10 minute
// constant did - "still processing after 600s" on a base that finished fine.
const BASE_BUDGET_MS = 5 * 60 * 1000;
const PER_DOCUMENT_BUDGET_MS = 30 * 1000;
const MAX_BUDGET_MS = 4 * 60 * 60 * 1000;

// The watchdog that lets an operator restart a run stuck in `indexing` must
// always trail the run's own budget, or the UI would offer a restart while the
// first run is still legitimately waiting, and two runs would fight.
const WATCHDOG_MARGIN_MS = 5 * 60 * 1000;

/**
 * Time to allow LightRAG for `documentCount` documents before giving up and
 * reporting them retryable.
 */
export function indexBudgetMs(documentCount: number): number {
  const count = Math.max(0, documentCount);
  const budget = BASE_BUDGET_MS + count * PER_DOCUMENT_BUDGET_MS;
  return Math.min(budget, MAX_BUDGET_MS);
}

/**
 * Age at which an `indexing` state is treated as abandoned rather than slow.
 */
export function staleIndexAfterMs(documentCount: number): number {
  return indexBudgetMs(documentCount) + WATCHDOG_MARGIN_MS;
}

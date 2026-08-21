import { indexBudgetMs, staleIndexAfterMs } from './indexBudget';

const MINUTE = 60 * 1000;
const MB = 1024 * 1024;

const docs = (...sizes: (number | null)[]): { sizeBytes: number | null }[] =>
  sizes.map((sizeBytes) => ({ sizeBytes }));

describe('indexBudgetMs', () => {
  it('gives a small document enough time without waiting for hours', () => {
    // 5 min base + 30 s for the document + ~0 for 3 KB of text.
    expect(indexBudgetMs(docs(3 * 1024))).toBeGreaterThan(5 * MINUTE);
    expect(indexBudgetMs(docs(3 * 1024))).toBeLessThan(6 * MINUTE);
  });

  it('scales with content volume, not just document count', () => {
    // The measurement this replaces: one 1 MB owner's manual is 217 chunks and
    // roughly 45 minutes of extraction plus merging. Counting documents gave
    // it 30 seconds.
    const oneBigFile = indexBudgetMs(docs(1 * MB));
    const manySmallFiles = indexBudgetMs(docs(...Array(20).fill(1024)));
    expect(oneBigFile).toBeGreaterThan(45 * MINUTE);
    expect(oneBigFile).toBeGreaterThan(manySmallFiles);
  });

  it('still pays a per-document cost, so many tiny files are not free', () => {
    expect(indexBudgetMs(docs(...Array(20).fill(1024)))).toBeGreaterThan(
      indexBudgetMs(docs(1024)),
    );
  });

  it('falls back to the per-document term when a size is unknown', () => {
    expect(indexBudgetMs(docs(null))).toBe(5 * MINUTE + 30 * 1000);
  });

  it('caps the wait so a runaway batch cannot block a run forever', () => {
    expect(indexBudgetMs(docs(...Array(500).fill(10 * MB)))).toBe(
      4 * 60 * MINUTE,
    );
  });

  it('handles an empty batch and negative sizes without going negative', () => {
    expect(indexBudgetMs([])).toBe(5 * MINUTE);
    expect(indexBudgetMs(docs(-5))).toBe(5 * MINUTE + 30 * 1000);
  });
});

describe('staleIndexAfterMs', () => {
  it('always trails the run budget, so a restart is never offered mid-run', () => {
    const batches = [
      [],
      docs(1024),
      docs(1 * MB),
      docs(...Array(50).fill(512 * 1024)),
      docs(...Array(500).fill(10 * MB)),
    ];
    for (const batch of batches) {
      expect(staleIndexAfterMs(batch)).toBeGreaterThan(indexBudgetMs(batch));
    }
  });
});

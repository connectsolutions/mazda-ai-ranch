import { indexBudgetMs, staleIndexAfterMs } from './indexBudget';

const MINUTE = 60 * 1000;

describe('indexBudgetMs', () => {
  it('gives a small base enough time without waiting for hours', () => {
    expect(indexBudgetMs(1)).toBe(5 * MINUTE + 30 * 1000);
  });

  it('scales with the batch, so a 200 document base is not cut short', () => {
    // The 10 minute constant this replaced reported a base that finished fine
    // as "still processing after 600s".
    expect(indexBudgetMs(200)).toBeGreaterThan(60 * MINUTE);
  });

  it('caps the wait so a runaway batch cannot block a run forever', () => {
    expect(indexBudgetMs(100000)).toBe(4 * 60 * MINUTE);
  });

  it('handles an empty batch without going negative', () => {
    expect(indexBudgetMs(0)).toBe(5 * MINUTE);
    expect(indexBudgetMs(-5)).toBe(5 * MINUTE);
  });
});

describe('staleIndexAfterMs', () => {
  it('always trails the run budget, so a restart is never offered mid-run', () => {
    for (const count of [0, 1, 50, 200, 100000]) {
      expect(staleIndexAfterMs(count)).toBeGreaterThan(indexBudgetMs(count));
    }
  });
});

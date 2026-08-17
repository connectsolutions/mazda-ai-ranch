import { deriveIndexStatus } from './source.mapper';

describe('deriveIndexStatus', () => {
  it('is indexed whenever a doc id is stored, even with a stale error', () => {
    // LightRAG confirmed the content is searchable; an older error must not
    // paint the row red.
    expect(
      deriveIndexStatus({ lightragDocId: 'doc-1', indexError: 'old' }),
    ).toBe('indexed');
  });

  it('is failed when the last run recorded an error and nothing succeeded', () => {
    expect(
      deriveIndexStatus({ lightragDocId: null, indexError: 'rejected' }),
    ).toBe('failed');
  });

  it('is pending when there is neither a doc id nor an error', () => {
    expect(deriveIndexStatus({ lightragDocId: null, indexError: null })).toBe(
      'pending',
    );
  });
});

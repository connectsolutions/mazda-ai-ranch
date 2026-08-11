import { SourceGateway } from './source.gateway';
import { SourceMapper } from './source.mapper';
import { ISourceData } from '../domain/source.types';
import {
  ITrackStatus,
  IDocumentRecord,
} from '../../lightrag/domain/lightrag.types';
import { indexBudgetMs } from '../domain/indexBudget';

const POLL_MS = 3000;
// The wait now scales with the batch, so derive it rather than hardcoding.
const TIMEOUT_MS = indexBudgetMs(1);

function makeSource(overrides: Partial<ISourceData> = {}): ISourceData {
  return {
    id: 'src-1',
    knowledgeId: 'knowledge-1',
    type: 'text',
    name: 'notes.txt',
    url: null,
    mimeType: null,
    content: 'Mazda CX-5 has a naturally aspirated engine.',
    sizeBytes: null,
    indexed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function processed(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processed', errorMessage: null }],
  };
}

function stillProcessing(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null }],
  };
}

function failed(message: string): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'failed', errorMessage: message }],
  };
}

function makePrismaStub(docIds: Record<string, string | null> = {}) {
  return {
    docIds,
    source: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ lightragDocId: docIds[where.id] ?? null }),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { lightragDocId: string | null };
        }) => {
          docIds[where.id] = data.lightragDocId;
          return Promise.resolve({ id: where.id });
        },
      ),
    },
  };
}

function inFlight(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null }],
  };
}

function duplicateOf(docId: string, originalStatus: string): ITrackStatus {
  return {
    documents: [
      {
        id: 'dup-1',
        status: 'failed',
        errorMessage: `Identical content already exists under another filename. Original doc_id: ${docId}, Status: ${originalStatus}`,
      },
    ],
  };
}

function makeLightragStub(
  statuses: ITrackStatus[],
  documents: IDocumentRecord[] = [],
) {
  const queue = [...statuses];
  return {
    ingestText: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    ingestUrl: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    ingestFile: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    getTrackStatus: jest.fn(() =>
      Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]),
    ),
    listDocuments: jest.fn(() => Promise.resolve(documents)),
  };
}

type Prisma = ConstructorParameters<typeof SourceGateway>[0];
type Lightrag = ConstructorParameters<typeof SourceGateway>[2];
type S3 = ConstructorParameters<typeof SourceGateway>[3];
type KnowledgeConfig = ConstructorParameters<typeof SourceGateway>[4];

function makeGateway(
  prisma: ReturnType<typeof makePrismaStub>,
  lightrag: ReturnType<typeof makeLightragStub>,
): SourceGateway {
  // The gateway's constructor takes the full Prisma client and the S3/config
  // deps, but indexSources only touches `source` and the LightRAG client, so
  // structural stubs are enough. Same idiom as browser.gateway.spec.ts.
  return new SourceGateway(
    prisma as unknown as Prisma,
    new SourceMapper(),
    lightrag as unknown as Lightrag,
    {} as unknown as S3,
    {} as unknown as KnowledgeConfig,
  );
}

describe('SourceGateway.indexSources', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists the doc id only once LightRAG reports the document processed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([stillProcessing(), processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    expect(outcomes).toEqual([
      { sourceId: 'src-1', name: 'notes.txt', indexed: true, error: null },
    ]);
    expect(prisma.docIds['src-1']).toBe('track-1');
  });

  it('leaves the source unindexed and surfaces the reason when processing fails', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([failed('embedding request rejected')]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes).toEqual([
      {
        sourceId: 'src-1',
        name: 'notes.txt',
        indexed: false,
        error: 'embedding request rejected',
      },
    ]);
    // No doc id persisted, so `indexed` stays false and the next run retries.
    expect(prisma.docIds['src-1']).toBeUndefined();
  });

  it('re-ingests a source that claims to be indexed when LightRAG has nothing for it', async () => {
    const prisma = makePrismaStub({ 'src-1': 'stale-track' });
    const lightrag = makeLightragStub([{ documents: [] }, processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource({ indexed: true })]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    expect(lightrag.ingestText).toHaveBeenCalledTimes(1);
    expect(outcomes[0].indexed).toBe(true);
    expect(prisma.docIds['src-1']).toBe('track-1');
  });

  it('does not re-ingest a source LightRAG still reports as processed', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { sourceId: 'src-1', name: 'notes.txt', indexed: true, error: null },
    ]);
    expect(prisma.docIds['src-1']).toBe('track-existing');
  });

  it('waits for a document still in the pipeline instead of re-uploading it', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([inFlight(), processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource({ indexed: true })]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    // Re-uploading here is what made LightRAG answer 409 "Document storage
    // already contains ..." when an index run overlapped a reprocess.
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0].indexed).toBe(true);
  });

  it('adopts the original document when the upload is refused as a duplicate', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      duplicateOf('doc-c8d0423fb8bc5700de256d6cb7fe89c8', 'processed'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes[0]).toEqual({
      sourceId: 'src-1',
      name: 'notes.txt',
      indexed: true,
      error: null,
    });
    expect(prisma.docIds['src-1']).toBe('doc-c8d0423fb8bc5700de256d6cb7fe89c8');
  });

  it('does not adopt an original document that failed itself', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      duplicateOf('doc-c8d0423fb8bc5700de256d6cb7fe89c8', 'failed'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes[0].indexed).toBe(false);
    expect(outcomes[0].error).toContain('Identical content already exists');
    expect(prisma.docIds['src-1']).toBeUndefined();
  });

  it('resolves an adopted doc id through the document snapshot', async () => {
    const prisma = makePrismaStub({
      'src-1': 'doc-c8d0423fb8bc5700de256d6cb7fe89c8',
    });
    // An adopted doc id is not a track id, so track_status knows nothing about
    // it. Without the snapshot fallback the source would be re-ingested and
    // refused as a duplicate again, forever.
    const lightrag = makeLightragStub(
      [{ documents: [] }],
      [
        {
          id: 'doc-c8d0423fb8bc5700de256d6cb7fe89c8',
          status: 'processed',
          filePath: 'notes.txt',
        },
      ],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0].indexed).toBe(true);
  });

  it('claims the stored document when the upload is refused by filename', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'processed', filePath: 'notes.txt' }],
    );
    // LightRAG names only the file in this refusal, never the doc id, so the
    // id has to come from the listing. Ranch reaches this state whenever it
    // lost the id for a document LightRAG still holds.
    lightrag.ingestText.mockRejectedValueOnce(
      new Error(
        `LightRAG /documents/upload failed: 409 {"detail":"Document storage already contains 'notes.txt' (Status: processed). Delete the existing record before re-uploading."}`,
      ),
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([makeSource()]);

    expect(outcomes[0]).toEqual({
      sourceId: 'src-1',
      name: 'notes.txt',
      indexed: true,
      error: null,
    });
    expect(prisma.docIds['src-1']).toBe('doc-stored');
  });

  it('still fails when the stored document under that filename is not processed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'failed', filePath: 'notes.txt' }],
    );
    lightrag.ingestText.mockRejectedValueOnce(
      new Error(
        `LightRAG /documents/upload failed: 409 {"detail":"Document storage already contains 'notes.txt' (Status: failed)."}`,
      ),
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([makeSource()]);

    // Claiming a failed document would hide a real problem behind a green
    // badge.
    expect(outcomes[0].indexed).toBe(false);
    expect(prisma.docIds['src-1']).toBeUndefined();
  });

  it('gives up after the timeout and reports the source as retryable', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([stillProcessing()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
    const outcomes = await run;

    expect(outcomes[0].indexed).toBe(false);
    expect(outcomes[0].error).toContain('still processing');
    expect(prisma.docIds['src-1']).toBeUndefined();
  });
});

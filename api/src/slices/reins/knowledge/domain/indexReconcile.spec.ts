import { IndexReconcileService } from './indexReconcile.service';
import { SourceService } from '../../source/domain/source.service';
import { ISourceData, ISourceIndexOutcome } from '../../source/domain';

function makeSource(id: string): ISourceData {
  return {
    id,
    knowledgeId: 'knowledge-1',
    type: 'file',
    name: `${id}.md`,
    url: 's3://bucket/key',
    mimeType: 'text/markdown',
    content: null,
    sizeBytes: 1024,
    indexed: false,
    indexStatus: 'pending',
    indexError: null,
    indexedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function confirmed(id: string): ISourceIndexOutcome {
  return {
    sourceId: id,
    name: `${id}.md`,
    status: 'indexed',
    indexed: true,
    error: null,
  };
}

function moving(id: string): ISourceIndexOutcome {
  return {
    sourceId: id,
    name: `${id}.md`,
    status: 'pending',
    indexed: false,
    error: 'still in LightRAG pipeline',
  };
}

function makeService(stub: Partial<SourceService>): IndexReconcileService {
  return new IndexReconcileService(stub as SourceService);
}

describe('IndexReconcileService.reconcile', () => {
  it('does nothing when no source is waiting on LightRAG', async () => {
    const confirmProcessed = jest.fn();
    const service = makeService({
      findUnconfirmed: jest.fn(() => Promise.resolve([])),
      confirmProcessed,
    });

    expect(await service.reconcile()).toBe(0);
    // The quiet case is the common one, so it must not cost a LightRAG call.
    expect(confirmProcessed).not.toHaveBeenCalled();
  });

  it('reports how many sources LightRAG finished since the last pass', async () => {
    const service = makeService({
      findUnconfirmed: jest.fn(() =>
        Promise.resolve([makeSource('src-1'), makeSource('src-2')]),
      ),
      confirmProcessed: jest.fn(() =>
        Promise.resolve([confirmed('src-1'), moving('src-2')]),
      ),
    });

    expect(await service.reconcile()).toBe(1);
  });

  it('does not start a second pass while one is still running', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const findUnconfirmed = jest.fn(() =>
      gate.then(() => [makeSource('src-1')]),
    );
    const service = makeService({
      findUnconfirmed,
      confirmProcessed: jest.fn(() => Promise.resolve([confirmed('src-1')])),
    });

    const first = service.reconcile();
    // Fires while the first pass is still awaiting: on a large base a pass
    // outlives the interval, and two passes would duplicate every status read.
    const second = await service.reconcile();
    release?.();

    expect(second).toBe(0);
    expect(await first).toBe(1);
    expect(findUnconfirmed).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when a pass throws, so it recovers next tick', async () => {
    const findUnconfirmed = jest
      .fn()
      .mockRejectedValueOnce(new Error('lightrag unreachable'))
      .mockResolvedValueOnce([]);
    const service = makeService({ findUnconfirmed });

    await expect(service.reconcile()).rejects.toThrow('lightrag unreachable');
    expect(await service.reconcile()).toBe(0);
    expect(findUnconfirmed).toHaveBeenCalledTimes(2);
  });
});

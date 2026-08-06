import { ConfigService } from '@nestjs/config';
import { ISettingGateway } from '#/setting/domain';
import { ISettingData, IUpsertSettingData } from '#/setting/domain';
import { IMcpServerGateway } from './mcpServer.gateway';
import {
  IMcpServerData,
  ICreateMcpServerData,
  IUpdateMcpServerData,
} from './mcpServer.types';
import {
  McpServerSeeder,
  RANCH_MCP_ID,
  KNOWLEDGE_MCP_ID,
  CLEANSLICE_MCP_ID,
} from './mcpServer.seeder';

function makeRow(id: string, url: string): IMcpServerData {
  return {
    id,
    name: id,
    description: null,
    url,
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: null,
    enabled: true,
    builtIn: true,
    templateIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

class FakeMcpServerGateway extends IMcpServerGateway {
  readonly created: ICreateMcpServerData[] = [];
  readonly updated: { id: string; data: IUpdateMcpServerData }[] = [];

  constructor(private rows: Map<string, IMcpServerData> = new Map()) {
    super();
  }

  findAll(): Promise<IMcpServerData[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  findById(id: string): Promise<IMcpServerData | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByIds(ids: string[]): Promise<IMcpServerData[]> {
    return Promise.resolve(
      ids
        .map((id) => this.rows.get(id))
        .filter((r): r is IMcpServerData => !!r),
    );
  }

  create(data: ICreateMcpServerData): Promise<IMcpServerData> {
    this.created.push(data);
    const row = makeRow(data.id ?? data.name, data.url);
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: string, data: IUpdateMcpServerData): Promise<IMcpServerData> {
    this.updated.push({ id, data });
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`missing row ${id}`);
    const next = { ...existing, ...data };
    this.rows.set(id, next);
    return Promise.resolve(next);
  }

  delete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

class FakeSettingGateway extends ISettingGateway {
  constructor(private ranchApiUrl: string | null) {
    super();
  }

  findAll(): Promise<ISettingData[]> {
    return Promise.resolve([]);
  }

  findByGroup(): Promise<ISettingData[]> {
    return Promise.resolve([]);
  }

  findByKey(group: string, name: string): Promise<ISettingData | null> {
    if (group !== 'integrations' || name !== 'ranch_api_url') {
      return Promise.resolve(null);
    }
    if (this.ranchApiUrl === null) return Promise.resolve(null);
    return Promise.resolve({
      id: 'setting-1',
      group,
      name,
      valueType: 'string',
      value: this.ranchApiUrl,
      updatedAt: new Date(0),
    });
  }

  upsert(
    group: string,
    name: string,
    data: IUpsertSettingData,
  ): Promise<ISettingData> {
    return Promise.resolve({
      id: 'setting-1',
      group,
      name,
      valueType: data.valueType,
      value: data.value,
      updatedAt: new Date(0),
    });
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return new ConfigService(env);
}

describe('McpServerSeeder', () => {
  it('derives the built-in url from integrations.ranch_api_url', async () => {
    const gateway = new FakeMcpServerGateway();
    const seeder = new McpServerSeeder(
      gateway,
      new FakeSettingGateway('http://ranch-api.ranch.svc.cluster.local:3333'),
      makeConfig(),
    );

    await seeder.onApplicationBootstrap();

    const ranch = gateway.created.find((c) => c.id === RANCH_MCP_ID);
    const knowledge = gateway.created.find((c) => c.id === KNOWLEDGE_MCP_ID);
    expect(ranch?.url).toBe(
      'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp',
    );
    expect(knowledge?.url).toBe(
      'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp',
    );
  });

  it('strips a trailing slash before appending the mcp endpoint', async () => {
    const gateway = new FakeMcpServerGateway();
    const seeder = new McpServerSeeder(
      gateway,
      new FakeSettingGateway('http://ranch-api.ranch.svc.cluster.local:3333/'),
      makeConfig(),
    );

    await seeder.onApplicationBootstrap();

    expect(gateway.created.find((c) => c.id === RANCH_MCP_ID)?.url).toBe(
      'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp',
    );
  });

  it('lets RANCH_MCP_URL win over the integration setting', async () => {
    const gateway = new FakeMcpServerGateway();
    const seeder = new McpServerSeeder(
      gateway,
      new FakeSettingGateway('http://ranch-api.ranch.svc.cluster.local:3333'),
      makeConfig({ RANCH_MCP_URL: 'http://pinned:9000/mcp/mcp' }),
    );

    await seeder.onApplicationBootstrap();

    expect(gateway.created.find((c) => c.id === RANCH_MCP_ID)?.url).toBe(
      'http://pinned:9000/mcp/mcp',
    );
  });

  it('heals a built-in row seeded with a stale url', async () => {
    const rows = new Map<string, IMcpServerData>([
      [RANCH_MCP_ID, makeRow(RANCH_MCP_ID, 'http://api:3001/mcp/mcp')],
      [KNOWLEDGE_MCP_ID, makeRow(KNOWLEDGE_MCP_ID, 'http://api:3001/mcp/mcp')],
    ]);
    const gateway = new FakeMcpServerGateway(rows);
    const seeder = new McpServerSeeder(
      gateway,
      new FakeSettingGateway('http://ranch-api.ranch.svc.cluster.local:3333'),
      makeConfig(),
    );

    await seeder.onApplicationBootstrap();

    const healed = gateway.updated.filter((u) => u.id !== CLEANSLICE_MCP_ID);
    expect(healed).toEqual([
      {
        id: RANCH_MCP_ID,
        data: { url: 'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp' },
      },
      {
        id: KNOWLEDGE_MCP_ID,
        data: { url: 'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp' },
      },
    ]);
  });

  it('leaves a row alone when its url already matches', async () => {
    const url = 'http://ranch-api.ranch.svc.cluster.local:3333/mcp/mcp';
    const rows = new Map<string, IMcpServerData>([
      [RANCH_MCP_ID, makeRow(RANCH_MCP_ID, url)],
      [KNOWLEDGE_MCP_ID, makeRow(KNOWLEDGE_MCP_ID, url)],
      [
        CLEANSLICE_MCP_ID,
        makeRow(CLEANSLICE_MCP_ID, 'https://mcp.cleanslice.org/mcp'),
      ],
    ]);
    const gateway = new FakeMcpServerGateway(rows);
    const seeder = new McpServerSeeder(
      gateway,
      new FakeSettingGateway('http://ranch-api.ranch.svc.cluster.local:3333'),
      makeConfig(),
    );

    await seeder.onApplicationBootstrap();

    expect(gateway.updated).toEqual([]);
    expect(gateway.created).toEqual([]);
  });
});

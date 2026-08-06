import { dedupeMcpServersByUrl } from './mcpServer.utils';
import { IMcpServerData } from './mcpServer.types';

function server(id: string, name: string, url: string): IMcpServerData {
  return {
    id,
    name,
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

const RANCH_URL = 'https://api.example.test/mcp/mcp';

describe('dedupeMcpServersByUrl', () => {
  it('collapses entries that point at the same endpoint', () => {
    // mcp-ranch and mcp-knowledge are both the api's own single MCP registry,
    // so keeping both registers all 41 tools twice in the agent.
    const kept = dedupeMcpServersByUrl([
      server('mcp-ranch', 'Ranch', RANCH_URL),
      server('mcp-cleanslice', 'CleanSlice', 'https://mcp.cleanslice.org/mcp'),
      server('mcp-knowledge', 'Knowledge', RANCH_URL),
    ]);

    expect(kept.map((s) => s.id)).toEqual(['mcp-ranch', 'mcp-cleanslice']);
  });

  it('keeps the first entry, so an attached server beats an injected one', () => {
    const kept = dedupeMcpServersByUrl([
      server('mcp-knowledge', 'Knowledge', RANCH_URL),
      server('mcp-ranch', 'Ranch', RANCH_URL),
    ]);

    expect(kept.map((s) => s.id)).toEqual(['mcp-knowledge']);
  });

  it('ignores trailing slashes and case when comparing urls', () => {
    const kept = dedupeMcpServersByUrl([
      server('a', 'A', 'https://api.example.test/mcp/mcp'),
      server('b', 'B', 'https://API.example.test/mcp/mcp/'),
    ]);

    expect(kept).toHaveLength(1);
  });

  it('leaves distinct endpoints alone', () => {
    const kept = dedupeMcpServersByUrl([
      server('a', 'A', RANCH_URL),
      server('b', 'B', 'https://mcp.cleanslice.org/mcp'),
    ]);

    expect(kept).toHaveLength(2);
  });
});

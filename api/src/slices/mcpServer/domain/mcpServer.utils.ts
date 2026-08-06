import { IMcpServerData } from './mcpServer.types';

/**
 * Ranch's MCP infrastructure is a single registry: every `@Tool` in the api
 * answers on one endpoint. So two entries pointing there - `mcp-ranch` and
 * `mcp-knowledge` - hand the agent the identical tool list twice, and the
 * runtime does not collapse them. Left alone that duplicates every tool
 * definition in each prompt and gives the model two identical handles to
 * choose between.
 *
 * The first entry for a url wins, so servers explicitly attached to a template
 * take precedence over auto-injected ones.
 */
export function dedupeMcpServersByUrl(
  servers: IMcpServerData[],
): IMcpServerData[] {
  const seen = new Set<string>();
  const kept: IMcpServerData[] = [];

  for (const server of servers) {
    const key = normalizeUrl(server.url);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(server);
  }

  return kept;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

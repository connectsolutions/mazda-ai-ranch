import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISettingGateway } from '#/setting/domain';
import { IMcpServerGateway } from './mcpServer.gateway';
import { ICreateMcpServerData } from './mcpServer.types';

export const RANCH_MCP_ID = 'mcp-ranch';
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';
export const CLEANSLICE_MCP_ID = 'mcp-cleanslice';

// Path the api mounts its Streamable HTTP MCP endpoint on. Must stay in sync
// with `mcpEndpoint` in McpModule.forRoot (app.module.ts). The bare origin
// 404s ("Cannot POST /"), so the path is load-bearing.
const MCP_ENDPOINT_PATH = '/mcp/mcp';

// Ranch API url as seen from inside agent pods. Same meaning and same default
// as `integrations.ranch_api_url` in the workflow gateway: agents reach the
// api over the k3d host network in local dev. On a real cluster the operator
// sets that integration (it is also what bridle uses), and the built-in MCP
// urls follow it automatically.
const RANCH_API_URL_FALLBACK = 'http://host.k3d.internal:3333';

type BuiltInDefinition = ICreateMcpServerData & { id: string };

@Injectable()
export class McpServerSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(McpServerSeeder.name);

  constructor(
    private gateway: IMcpServerGateway,
    private settings: ISettingGateway,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const ranchUrl = await this.resolveRanchMcpUrl();
    // The Streamable HTTP endpoint lives at /mcp — the bare origin 404s
    // ("Cannot POST /"), which used to leave every agent with 0 CleanSlice
    // tools and a scary connect-failed line in its startup log.
    const cleansliceUrl =
      this.config.get<string>('CLEANSLICE_MCP_URL') ??
      'https://mcp.cleanslice.org/mcp';

    await this.ensureBuiltIn({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes ranch-management tools (list_agents, restart_agent, write_agent_file, ...). Auth uses the agent's RANCH_API_TOKEN.",
      url: ranchUrl,
      transport: 'streamableHttp',
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      enabled: true,
      builtIn: true,
    });

    await this.ensureBuiltIn({
      id: KNOWLEDGE_MCP_ID,
      name: 'Knowledge',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes query_knowledge for knowledge bases bound to the calling agent. Auth uses the agent's RANCH_API_TOKEN.",
      url: ranchUrl,
      transport: 'streamableHttp',
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      enabled: true,
      builtIn: true,
    });

    await this.ensureBuiltIn({
      id: CLEANSLICE_MCP_ID,
      name: 'CleanSlice',
      description:
        'Built-in MCP server hosted at mcp.cleanslice.org. Exposes CleanSlice architecture documentation and helpers (get-started, list-categories, search, read-doc). Auto-attached to every agent.',
      url: cleansliceUrl,
      transport: 'streamableHttp',
      authType: 'none',
      authValue: null,
      enabled: true,
      builtIn: true,
    });
  }

  /**
   * The api owns built-in rows: their url is not editable through the public
   * API and they cannot be deleted (see McpServerController), so a row seeded
   * with a wrong url used to be unfixable short of a manual DB write. Converge
   * the url on every bootstrap instead. Idempotent once the row matches.
   * Agents pick the change up on their next deploy, because the MCP list is
   * baked into pod env at deploy time.
   */
  private async ensureBuiltIn(definition: BuiltInDefinition): Promise<void> {
    const existing = await this.gateway.findById(definition.id);

    if (!existing) {
      await this.gateway.create(definition);
      this.logger.log(
        `Seeded built-in ${definition.name} MCP server at ${definition.url}`,
      );
      return;
    }

    if (existing.url === definition.url) return;

    await this.gateway.update(definition.id, { url: definition.url });
    this.logger.log(
      `Healed built-in ${definition.name} MCP server url: ${existing.url} -> ${definition.url}`,
    );
  }

  /**
   * Operators can pin the url with RANCH_MCP_URL. Otherwise it is derived from
   * the `integrations.ranch_api_url` setting, which already describes how
   * agent pods reach this api (bridle uses the same value). Deriving it keeps
   * a single source of truth: a deployment that can reach the api for bridle
   * can reach it for MCP too.
   */
  private async resolveRanchMcpUrl(): Promise<string> {
    const explicit = this.config.get<string>('RANCH_MCP_URL')?.trim();
    if (explicit && explicit.length > 0) return explicit;

    const setting = await this.settings.findByKey(
      'integrations',
      'ranch_api_url',
    );
    const configured =
      typeof setting?.value === 'string' ? setting.value.trim() : '';
    const base = configured.length > 0 ? configured : RANCH_API_URL_FALLBACK;

    return `${base.replace(/\/+$/, '')}${MCP_ENDPOINT_PATH}`;
  }
}

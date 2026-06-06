import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  buildMetaToolDefinitions,
  CALL_API_ENDPOINT_TOOL,
  SEARCH_API_REGISTRY_TOOL,
  SEARCH_BUSINESS_DATA_TOOL,
  type ChatApiRegistryEntry,
} from '@alga-psa/agent-tooling';
import type { InstanceClient } from './instanceClient.js';
import {
  handleCallApiEndpoint,
  handleSearchApiRegistry,
  handleSearchBusinessData,
  type ToolOutcome,
} from './tools.js';

export interface CreateServerOptions {
  registry: ChatApiRegistryEntry[];
  client: InstanceClient;
  name?: string;
  version?: string;
}

/**
 * Build the MCP server exposing the 3 constant meta-tools. The local connector
 * is always user-scoped (CE edition templating — no approval step), regardless
 * of the instance edition that served the registry.
 */
export function createServer(opts: CreateServerOptions): Server {
  const server = new Server(
    { name: opts.name ?? 'alga-psa', version: opts.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const tools = buildMetaToolDefinitions({ edition: 'ce' });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    let outcome: ToolOutcome;
    try {
      if (name === SEARCH_API_REGISTRY_TOOL) {
        outcome = await handleSearchApiRegistry(opts.registry, args);
      } else if (name === SEARCH_BUSINESS_DATA_TOOL) {
        outcome = await handleSearchBusinessData(opts.client, args);
      } else if (name === CALL_API_ENDPOINT_TOOL) {
        outcome = await handleCallApiEndpoint(opts.registry, opts.client, args);
      } else {
        outcome = { data: { error: `Unknown tool: ${name}` }, isError: true };
      }
    } catch (error) {
      // Network/unexpected failures surface as a structured tool error so the
      // model can recover rather than the whole call crashing.
      outcome = { data: { error: (error as Error).message }, isError: true };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(outcome.data ?? null, null, 2) }],
      isError: outcome.isError,
    };
  });

  return server;
}

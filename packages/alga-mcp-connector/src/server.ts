import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  buildMetaToolDefinitions,
  dispatchMetaTool,
  jsonToolResult,
  MCP_SERVER_INSTRUCTIONS,
  type ChatApiRegistryEntry,
  type ToolResult,
} from '@alga-psa/agent-tooling';
import type { InstanceClient } from './instanceClient.js';

export interface CreateServerOptions {
  registry: ChatApiRegistryEntry[];
  client: InstanceClient;
  name?: string;
  version?: string;
}

/**
 * Build the MCP server exposing the constant meta-tools (search, call, attach_file, read_attachment). The local connector
 * is always user-scoped (CE edition templating — no approval step), regardless
 * of the instance edition that served the registry.
 */
export function createServer(opts: CreateServerOptions): Server {
  const server = new Server(
    { name: opts.name ?? 'alga-psa', version: opts.version ?? '0.1.0' },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
  );

  const tools = buildMetaToolDefinitions({ edition: 'ce' });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    let result: ToolResult;
    try {
      result = await dispatchMetaTool(name, args, {
        registry: opts.registry,
        transport: opts.client.transport(),
        searchPath: opts.client.searchPath,
      });
    } catch (error) {
      // Network/unexpected failures surface as a structured tool error so the
      // model can recover rather than the whole call crashing.
      result = jsonToolResult({ error: (error as Error).message }, true);
    }

    return {
      content: result.content,
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      isError: result.isError,
    };
  });

  return server;
}

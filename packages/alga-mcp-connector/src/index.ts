import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { InstanceClient } from './instanceClient.js';
import { createServer } from './server.js';

// IMPORTANT: stdout is the MCP JSON-RPC channel — all diagnostics go to stderr.
function log(message: string): void {
  process.stderr.write(`[alga-mcp-connector] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new InstanceClient(config);

  log(`Loading API registry from ${config.instanceUrl}${config.registryPath} ...`);
  const registry = await client.fetchRegistry();
  log(`Loaded ${registry.length} endpoints. Starting stdio MCP server.`);

  const server = createServer({ registry, client });
  await server.connect(new StdioServerTransport());
  log('Connected. Awaiting MCP requests on stdio.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[alga-mcp-connector] fatal: ${message}\n`);
  process.exit(1);
});

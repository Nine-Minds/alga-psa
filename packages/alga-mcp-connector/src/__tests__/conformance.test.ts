import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ChatApiRegistryEntry } from '@alga-psa/agent-tooling';
import { chatApiRegistry as ceRegistry } from '../../../../server/src/lib/mcp/registry.generated';
import { chatApiRegistry as eeRegistry } from '../../../../ee/server/src/chat/registry/apiRegistry.generated';
import { createServer } from '../server';
import type { EndpointResult, InstanceClient } from '../instanceClient';

const REGISTRY: ChatApiRegistryEntry[] = [
  {
    id: 'tickets.list',
    method: 'get',
    path: '/api/v1/tickets',
    displayName: 'List Tickets',
    tags: ['Tickets'],
    approvalRequired: false,
    parameters: [],
  },
];

function fakeClient(result: EndpointResult): InstanceClient {
  return {
    callEndpoint: async () => result,
    searchBusinessData: async () => result,
  } as unknown as InstanceClient;
}

async function connectedClient(client: InstanceClient) {
  const server = createServer({ registry: REGISTRY, client });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

describe('MCP stdio-protocol conformance (T011)', () => {
  it('lists exactly the 4 meta-tools', async () => {
    const client = await connectedClient(fakeClient({ status: 200, ok: true, data: {} }));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['attach_file', 'call_api_endpoint', 'search_api_registry', 'search_business_data']);
  });

  it('invokes search_api_registry over the protocol and returns results', async () => {
    const client = await connectedClient(fakeClient({ status: 200, ok: true, data: {} }));
    const res = await client.callTool({ name: 'search_api_registry', arguments: { query: 'list tickets' } });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as { results: Array<{ entryId: string }> };
    expect(parsed.results[0].entryId).toBe('tickets.list');
  });

  it('surfaces an HTTP failure from call_api_endpoint as isError over the protocol', async () => {
    const client = await connectedClient(fakeClient({ status: 500, ok: false, data: { error: 'boom' } }));
    const res = await client.callTool({ name: 'call_api_endpoint', arguments: { entryId: 'tickets.list' } });
    expect(res.isError).toBe(true);
  });

  // Ticket watchers vs additional agents: an assistant asked to copy someone on updates must
  // reach the watcher endpoint (persistent watch list), not the internal-staff agents endpoint.
  describe('ticket watcher routing over the real generated registries', () => {
    const QUERIES = [
      'add an external watcher',
      'cc a contact on ticket updates',
      'copy an external email on updates',
    ];
    const WATCHER_POST = { method: 'post', path: '/api/v1/tickets/{id}/watchers' };
    const AGENTS_POST = { method: 'post', path: '/api/v1/tickets/{id}/agents' };

    for (const [edition, registry] of [['ce', ceRegistry], ['ee', eeRegistry]] as const) {
      for (const query of QUERIES) {
        it(`[${edition}] "${query}" ranks POST .../watchers above POST .../agents`, async () => {
          const server = createServer({ registry, client: fakeClient({ status: 200, ok: true, data: {} }) });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const mcpClient = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
          await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

          const res = await mcpClient.callTool({
            name: 'search_api_registry',
            arguments: { query }, // default limit (top 5): what an assistant actually sees
          });
          expect(res.isError).toBeFalsy();
          const content = res.content as Array<{ type: string; text: string }>;
          const { results } = JSON.parse(content[0].text) as {
            results: Array<{ entryId: string; method: string; path: string }>;
          };
          const rank = (t: { method: string; path: string }) =>
            results.findIndex((r) => r.method.toLowerCase() === t.method && r.path === t.path);
          const watcherRank = rank(WATCHER_POST);
          const agentsRank = rank(AGENTS_POST);
          console.log(`[ranking:${edition}] "${query}" watchers=${watcherRank + 1} agents=${agentsRank < 0 ? 'absent' : agentsRank + 1}`);

          expect(watcherRank).toBeGreaterThanOrEqual(0);
          if (agentsRank >= 0) expect(watcherRank).toBeLessThan(agentsRank);
        });
      }
    }

    const REVERSE_QUERIES = [
      'add another technician to this ticket',
      'add a coworker to help on this ticket',
    ];
    for (const [edition, registry] of [['ce', ceRegistry], ['ee', eeRegistry]] as const) {
      for (const query of REVERSE_QUERIES) {
        it(`[${edition}] "${query}" ranks POST .../agents above POST .../watchers`, async () => {
          const server = createServer({ registry, client: fakeClient({ status: 200, ok: true, data: {} }) });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const mcpClient = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
          await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

          const res = await mcpClient.callTool({
            name: 'search_api_registry',
            arguments: { query }, // default limit (top 5)
          });
          expect(res.isError).toBeFalsy();
          const content = res.content as Array<{ type: string; text: string }>;
          const { results } = JSON.parse(content[0].text) as {
            results: Array<{ entryId: string; method: string; path: string }>;
          };
          const rank = (t: { method: string; path: string }) =>
            results.findIndex((r) => r.method.toLowerCase() === t.method && r.path === t.path);
          const watcherRank = rank(WATCHER_POST);
          const agentsRank = rank(AGENTS_POST);
          console.log(`[ranking:${edition}] "${query}" watchers=${watcherRank < 0 ? 'absent' : watcherRank + 1} agents=${agentsRank < 0 ? 'absent' : agentsRank + 1}`);

          expect(agentsRank).toBeGreaterThanOrEqual(0);
          if (watcherRank >= 0) expect(agentsRank).toBeLessThan(watcherRank);
        });
      }
    }
  });
});

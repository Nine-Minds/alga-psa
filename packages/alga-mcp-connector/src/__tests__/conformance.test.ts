import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ChatApiRegistryEntry } from '@alga-psa/agent-tooling';
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
  it('lists exactly the 3 meta-tools', async () => {
    const client = await connectedClient(fakeClient({ status: 200, ok: true, data: {} }));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['call_api_endpoint', 'search_api_registry', 'search_business_data']);
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
});

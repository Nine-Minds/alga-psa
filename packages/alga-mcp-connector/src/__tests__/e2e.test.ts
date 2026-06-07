import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../config';
import { InstanceClient } from '../instanceClient';
import { createServer } from '../server';

// A mock AlgaPSA instance: serves the registry + a couple of endpoints, and
// enforces the x-api-key header. Exercises the REAL InstanceClient over real
// HTTP and the REAL MCP protocol (search -> call -> /api/v1 dispatch).

const TOKEN = 'test-key';
const REGISTRY_ENTRIES = [
  { id: 'tickets.list', method: 'get', path: '/api/v1/tickets', displayName: 'List Tickets', tags: ['Tickets'], approvalRequired: false, parameters: [] },
  { id: 'tickets.get', method: 'get', path: '/api/v1/tickets/{id}', displayName: 'Get Ticket', tags: ['Tickets'], approvalRequired: false, parameters: [{ name: 'id', in: 'path', required: true }] },
];
const TICKET = { id: 't-1', title: 'Printer down', status: 'open' };

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.headers['x-api-key'] !== TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/v1/meta/mcp-registry') {
      // Alga wraps responses in a { data: ... } envelope.
      json(200, { data: { edition: 'ce', count: REGISTRY_ENTRIES.length, entries: REGISTRY_ENTRIES } });
    } else if (url.pathname === '/api/v1/tickets') {
      json(200, { data: [TICKET] });
    } else if (url.pathname === '/api/v1/tickets/t-1') {
      json(200, { data: TICKET });
    } else {
      json(404, { error: 'not found' });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(token = TOKEN) {
  const config = loadConfig({ ALGA_INSTANCE_URL: baseUrl, ALGA_API_TOKEN: token } as NodeJS.ProcessEnv);
  const client = new InstanceClient(config);
  const registry = await client.fetchRegistry();
  const mcpServer = createServer({ registry, client });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'e2e', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([mcpServer.connect(serverTransport), mcp.connect(clientTransport)]);
  return { mcp, registry };
}

describe('E2E (T009, T012) — real HTTP instance + MCP protocol', () => {
  it('fetches the registry from the instance and lists the 3 tools', async () => {
    const { mcp, registry } = await connect();
    expect(registry.length).toBe(2);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'call_api_endpoint',
      'search_api_registry',
      'search_business_data',
    ]);
  });

  it('searches then reads a ticket end-to-end (search -> call -> GET /api/v1/tickets/{id})', async () => {
    const { mcp } = await connect();

    const search = await mcp.callTool({ name: 'search_api_registry', arguments: { query: 'get ticket by id' } });
    const searchContent = search.content as Array<{ type: string; text: string }>;
    const found = JSON.parse(searchContent[0].text) as { results: Array<{ entryId: string }> };
    expect(found.results[0].entryId).toBe('tickets.get');

    const call = await mcp.callTool({ name: 'call_api_endpoint', arguments: { entryId: 'tickets.get', path: { id: 't-1' } } });
    expect(call.isError).toBeFalsy();
    const callContent = call.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(callContent[0].text) as { ok: boolean; data: { data: { title: string } } };
    expect(payload.ok).toBe(true);
    expect(payload.data.data.title).toBe('Printer down');
  });

  it('rejects a bad token at registry fetch with a clear auth error', async () => {
    await expect(connect('wrong-token')).rejects.toThrow(/Authentication failed|Failed to load the API registry/);
  });
});

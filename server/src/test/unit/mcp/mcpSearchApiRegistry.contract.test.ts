import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Contract for the hosted `/api/mcp` `search_api_registry` tool (alga0002071).
 * Drives the REAL handleMcpJsonRpc + CE generated registry; only the auth seam
 * and the edition flag are mocked. The parity assertion locks the hosted
 * surface to the shared runRegistrySearch so a local hit mapper cannot return.
 */
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ api_key_id: 'k1', tenant: 't-1', user_id: 'u-1' })),
  },
}));
// Pin the CE generated registry; @product/chat/entry is not reliably importable in unit tests.
vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => false }));

import { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';
import { loadMcpRegistry } from '@/lib/mcp/loadRegistry';
import { runRegistrySearch, type RegistrySearchResponse } from '@alga-psa/agent-tooling';

async function callSearch(args: Record<string, unknown>): Promise<RegistrySearchResponse> {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_api_registry', arguments: args },
    }),
  });
  const res = await handleMcpJsonRpc(req);
  const body = await res.json();
  expect(body.result.isError).toBe(false);
  return JSON.parse(body.result.content[0].text);
}

describe('hosted MCP search_api_registry contract', () => {
  it('surfaces nested phone_numbers items on POST /api/v1/contacts', async () => {
    const data = await callSearch({ query: 'create contact', limit: 5 });
    const hit = data.results.find((r) => r.method === 'POST' && r.path === '/api/v1/contacts');
    expect(hit).toBeDefined();
    const schema = hit!.requestBodySchema as any;
    const items = schema.properties.phone_numbers.items;
    expect(items).toBeTypeOf('object');
    expect(Object.keys(items.properties ?? {}).length).toBeGreaterThan(0);
  });

  it('surfaces a non-empty schema on POST /api/v1/time-entries', async () => {
    const data = await callSearch({ query: 'create time entry', limit: 5 });
    const hit = data.results.find((r) => r.method === 'POST' && r.path === '/api/v1/time-entries');
    expect(hit).toBeDefined();
    expect(Object.keys((hit!.requestBodySchema as object) ?? {}).length).toBeGreaterThan(0);
  });

  it('matches runRegistrySearch exactly (anti-drift parity)', async () => {
    const args = { query: 'create contact', limit: 5 };
    const hosted = await callSearch(args);
    const { entries } = await loadMcpRegistry();
    const direct = runRegistrySearch(entries, args);
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    // Hosted output is JSON text, so compare against the JSON-normalised direct result.
    expect(hosted).toEqual(JSON.parse(JSON.stringify(direct.data)));
  });

  it('keeps every serialized requestBodySchema within the 16 KB budget', async () => {
    const { entries } = await loadMcpRegistry();
    const oversized = entries
      .filter((e) => JSON.stringify(e.requestBodySchema ?? '').length > 16_384)
      .map((e) => e.id);
    expect(oversized).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Finding f2 (alga-2026-0003021): a secret a tool returns (webhook signing_secret on rotate)
 * must reach the agent but never the mcp_agent_audit row. Drives the real handleOne +
 * writeAgentAudit and captures the insert.
 */
const inserts: Array<Record<string, any>> = [];

vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => false }));
vi.mock('@ee/lib/mcp/idpToken', () => ({
  looksLikeJwt: () => true,
  authenticateAgentToken: vi.fn(async () => ({
    ok: true,
    ctx: { resolved: { tenant: 't-1', agent: { agent_id: 'agent-1' }, backingUserId: 'u-1' } },
  })),
}));
vi.mock('@ee/lib/mcp/agents', () => ({ mintAgentSessionKey: vi.fn(async () => 'session-key') }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tenantDb: () => ({
    table: () => ({
      insert: async (row: Record<string, any>) => {
        inserts.push(row);
      },
    }),
  }),
}));

import { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';

const SECRET = 'whsec_SuperSecretSigningValue42';
const ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllGlobals();
  inserts.length = 0;
});

describe('MCP audit secret redaction at the writeAgentAudit boundary', () => {
  it('returns the signing secret to the agent but never writes it to mcp_agent_audit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { webhook_id: ID, signing_secret: SECRET } }), { status: 200 })),
    );
    const req = new NextRequest('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer a.b.c' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'call_api_endpoint',
          arguments: { entryId: 'post-_api_v1_webhooks_id_secret_rotate', parameters: { path: { id: ID } } },
        },
      }),
    });
    const body = await (await handleMcpJsonRpc(req)).json();

    // The agent still receives the secret.
    expect(body.result.isError).toBe(false);
    expect(JSON.stringify(body)).toContain(SECRET);

    // The audit row does not.
    expect(inserts).toHaveLength(1);
    expect(JSON.stringify(inserts[0])).not.toContain(SECRET);
    expect(inserts[0].tool).toBe('call_api_endpoint');
    expect(inserts[0].ok).toBe(true);
    expect(JSON.parse(inserts[0].result_summary)).toMatchObject({ status: 200, ok: true });
  });
});

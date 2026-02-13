import { describe, expect, it, vi, beforeEach } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

// The webhook handler imports these, but the auth-path tests should never reach them.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
}));
vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/syncSingleAgent', () => ({
  syncTacticalSingleAgentForTenant: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

describe('Tactical webhook auth', () => {
  beforeEach(() => {
    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, _key: string) => 'expected_secret'),
    };
  });

  it('returns 401 when webhook secret header is missing (no x-api-key required)', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const req = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'a1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/missing webhook secret/i);
  });

  it('returns 401 when webhook secret header is invalid', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const req = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Alga-Webhook-Secret': 'wrong',
      },
      body: JSON.stringify({ agent_id: 'a1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid webhook secret/i);
  });
});


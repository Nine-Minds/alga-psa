import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
const isTenantSuspended = vi.fn(async () => false);
const createTenantKnex = vi.fn(async () => ({ knex: {} }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

// Auth-path tests must never reach the DB beyond the suspension gate.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...a: any[]) => (createTenantKnex as any)(...a),
  isTenantSuspended: (...a: any[]) => (isTenantSuspended as any)(...a),
  tenantDb: () => ({
    table: () => {
      throw new Error('table access should not be reached in auth tests');
    },
  }),
}));

const syncDattoSingleDeviceForTenant = vi.fn(async () => ({ updated: true }));
vi.mock('@ee/lib/integrations/datto/syncSingleDevice', () => ({
  syncDattoSingleDeviceForTenant: (...a: any[]) => (syncDattoSingleDeviceForTenant as any)(...a),
}));
vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  buildDattoClientForTenant: vi.fn(async () => null),
}));
vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: vi.fn(() => ({})),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const url = 'http://localhost/api/webhooks/datto?tenant=tenant_1';
const post = (headers: Record<string, string> = {}, body: unknown = { alertUid: 'a1', deviceUid: 'd1' }, u = url) =>
  new Request(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('Datto webhook auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTenantSuspended.mockResolvedValue(false);
    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) =>
        key === 'datto_rmm_webhook_secret' ? 'expected_secret' : null
      ),
    };
  });

  it('T042: 400 when tenant is missing', async () => {
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    const res = await POST(post({ 'X-Alga-Webhook-Secret': 'expected_secret' }, undefined, 'http://localhost/api/webhooks/datto'));
    expect(res.status).toBe(400);
  });

  it('401 when the secret header is missing (no x-api-key required)', async () => {
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/missing webhook secret/i);
  });

  it('401 with no detail when the secret is wrong, of different or equal length, or the tenant has none', async () => {
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    for (const wrong of ['wrong', 'expected_secreX', 'expected_secret_longer']) {
      const res = await POST(post({ 'X-Alga-Webhook-Secret': wrong }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    }

    secretProvider = { getTenantSecret: vi.fn(async () => null) };
    const res = await POST(post({ 'X-Alga-Webhook-Secret': 'expected_secret' }));
    expect(res.status).toBe(401);
  });

  it('reads the secret from the Datto tenant-secret key', async () => {
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    await POST(post({ 'X-Alga-Webhook-Secret': 'wrong' }));
    expect(secretProvider.getTenantSecret).toHaveBeenCalledWith('tenant_1', 'datto_rmm_webhook_secret');
  });

  it('T042: suspended tenant gets a 200 ack with no processing', async () => {
    isTenantSuspended.mockResolvedValue(true);
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    const res = await POST(post({ 'X-Alga-Webhook-Secret': 'expected_secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'tenant_suspended' });
    expect(syncDattoSingleDeviceForTenant).not.toHaveBeenCalled();
  });

  it('400 on invalid JSON and when alertUid is absent or an unrendered placeholder', async () => {
    const { POST } = await import('@ee/app/api/webhooks/datto/route');
    const headers = { 'X-Alga-Webhook-Secret': 'expected_secret' };
    expect((await POST(post(headers, 'not json'))).status).toBe(400);
    expect((await POST(post(headers, { deviceUid: 'd1' }))).status).toBe(400);
    expect((await POST(post(headers, { alertUid: '[alert_uid]', deviceUid: 'd1' }))).status).toBe(400);
  });

  it('answers OPTIONS with 204', async () => {
    const { OPTIONS } = await import('@ee/app/api/webhooks/datto/route');
    expect((await OPTIONS()).status).toBe(204);
  });
});

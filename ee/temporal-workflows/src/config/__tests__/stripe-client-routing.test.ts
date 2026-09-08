import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ update: vi.fn(async () => 1), scopes: [] as string[] }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: async () => 'sk_test_worker_routing',
  getSecretProviderInstance: async () => ({ getAppSecret: async () => 'sk_test_worker_routing' }) }));
vi.mock('@temporalio/activity', () => ({ Context: { current: () => ({ log: { info() {}, error() {}, warn() {} } }) } }));
vi.mock('@alga-psa/db/admin.js', () => ({ getAdminConnection: async () => ({ fn: { now: () => new Date('2026-09-08') } }), refreshAdminConnection: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: (_db: unknown, tenant: string) => {
  database.scopes.push(tenant);
  return { table: () => ({ whereIn: () => ({ first: async () => ({ stripe_subscription_id: 'internal-sub', stripe_subscription_external_id: 'sub_fixture' }) }),
    where: () => ({ update: database.update }) }) };
} }));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({ TagModel: {} }));
vi.mock('../../db/tenant-operations.js', () => ({ insertStripeSubscriptionForTenant: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

it('routes the actual worker subscription metadata service through the configured HTTP endpoint', async () => {
  // Neither exercised path should open TLS: the only allowed endpoint is our
  // loopback HTTP receiver. Guard independently of either client constructor.
  const tlsGuard = vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('Test refused unexpected outbound HTTPS before connection');
  });
  const received: Array<{ url: string; method: string; body: string; authorization: string }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ url: req.url!, method: req.method!, body: Buffer.concat(chunks).toString(), authorization: String(req.headers.authorization) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'sub_fixture', object: 'subscription', metadata: { tenant_id: 'tenant-fixture' }, status: req.method === 'DELETE' ? 'canceled' : 'active' }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    vi.stubEnv('STRIPE_API_BASE_URL', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const { getStripeClient, updateSubscriptionMetadata } = await import('../../services/stripe-service');
    const client = await getStripeClient();
    // Guard against sending synthetic credentials to Stripe if routing regresses.
    expect((client as any).getApiField('host')).toBe('127.0.0.1');
    await updateSubscriptionMetadata('sub_fixture', { tenant_id: 'tenant-fixture' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/v1/subscriptions/sub_fixture', authorization: 'Bearer sk_test_worker_routing' });
    expect(new URLSearchParams(received[0].body).get('metadata[tenant_id]')).toBe('tenant-fixture');
    const { cancelTenantStripeSubscription } = await import('../../activities/tenant-deletion-activities');
    const cancellation = await cancelTenantStripeSubscription('tenant-fixture');
    expect(tlsGuard.mock.calls.length, 'Outbound HTTPS attempts blocked before connection').toBe(0);
    expect(cancellation).toEqual({ canceled: true, subscriptionId: 'sub_fixture' });
    expect(received).toHaveLength(2);
    expect(received[1]).toMatchObject({ method: 'DELETE', url: '/v1/subscriptions/sub_fixture', authorization: 'Bearer sk_test_worker_routing' });
    expect(database.scopes).toEqual(['tenant-fixture']);
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


it('preserves the live Stripe endpoint by default and rejects malformed overrides', async () => {
  const { createWorkerStripeClient } = await import('../stripeClient');
  const live = createWorkerStripeClient('sk_test_not_sent', {});
  expect((live as any).getApiField('host')).toBe('api.stripe.com');
  expect((live as any).getApiField('protocol')).toBe('https');
  for (const override of ['ftp://localhost', 'http://user:secret@localhost', 'http://localhost/other', 'http://localhost?token=value']) {
    expect(() => createWorkerStripeClient('sk_test_not_sent', { STRIPE_API_BASE_URL: override })).toThrow();
  }
});

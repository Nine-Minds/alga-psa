/**
 * Card 78af6fe8 — the v1 webhooks API ran on an `undefined` DatabaseService, so every read 500'd.
 *
 * DB-backed. Run with the dev stack env:
 *   cd server && set -a && . ../.env.localtest && set +a && TEST_DB_NAME=test_webhook_api \
 *     npx vitest run src/test/integration/webhook.apiServiceTenantScoped.integration.test.ts --coverage.enabled=false
 *
 * Drives ApiWebhookController.list / getById / getDeliveries (as the controller builds WebhookService) against
 * real webhook rows, and checks deleteWebhook leaves another tenant's rows alone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const state = vi.hoisted(() => ({
  db: null as any,
  secrets: new Map<string, string>(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async (tenant: string, name: string) => state.secrets.get(`${tenant}/${name}`) ?? null,
    setTenantSecret: async (tenant: string, name: string, value: string) => {
      state.secrets.set(`${tenant}/${name}`, value);
    },
    deleteTenantSecret: async (tenant: string, name: string) => {
      state.secrets.delete(`${tenant}/${name}`);
    },
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});

vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, runWithTenant: async (_tenant: string, cb: () => Promise<unknown>) => cb() };
});

vi.mock('@alga-psa/validation', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, validateTenantAccess: vi.fn(async () => undefined) };
});

import { ApiWebhookController } from '@/lib/api/controllers/ApiWebhookController';
import { WebhookService } from '@/lib/api/services/WebhookService';
import { webhookModel } from '@/lib/webhooks/webhookModel';

describe('v1 webhooks API on the tenant-scoped webhookModel', () => {
  const proto: any = ApiWebhookController.prototype;
  const originalAuthenticate = proto.authenticate;
  const originalCheckPermission = proto.checkPermission;

  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let webhookA1: string;
  let webhookA2: string;
  let webhookB: string;
  let currentTenant: string;

  const request = (path: string) =>
    new NextRequest(`http://localhost${path}`, { headers: { 'x-api-key': 'irrelevant' } }) as any;

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    state.db = await createTestDbConnection();

    tenantA = await createTenant(state.db, 'Webhook API Tenant A');
    tenantB = await createTenant(state.db, 'Webhook API Tenant B');
    userA = await createUser(state.db, tenantA, { user_type: 'internal' });
    userB = await createUser(state.db, tenantB, { user_type: 'internal' });

    const make = async (tenant: string, user: string, name: string, eventTypes: string[]) =>
      (
        await webhookModel.insert({
          tenant,
          name,
          url: `https://example.test/${name}`,
          eventTypes,
          signingSecret: 's3cret',
          createdByUserId: user,
        })
      ).webhookId;

    webhookA1 = await make(tenantA, userA, 'alpha', ['ticket.created']);
    webhookA2 = await make(tenantA, userA, 'beta', ['ticket.updated']);
    webhookB = await make(tenantB, userB, 'tenant-b-hook', ['ticket.created']);

    for (const [tenant, webhookId] of [[tenantA, webhookA1], [tenantB, webhookB]] as const) {
      await webhookModel.recordDelivery({
        tenant,
        webhookId,
        eventId: uuidv4(),
        eventType: 'ticket.created',
        status: 'delivered',
      });
    }
    await webhookModel.recordDelivery({
      tenant: tenantA,
      webhookId: webhookA1,
      eventId: uuidv4(),
      eventType: 'ticket.created',
      status: 'failed',
    });
  }, 120_000);

  afterAll(async () => {
    await state.db?.destroy().catch(() => undefined);
  }, 60_000);

  beforeEach(() => {
    currentTenant = tenantA;
    proto.authenticate = async (req: any) => {
      req.context = { tenant: currentTenant, userId: userA };
      return req;
    };
    proto.checkPermission = async () => undefined;
  });

  afterEach(() => {
    proto.authenticate = originalAuthenticate;
    proto.checkPermission = originalCheckPermission;
  });

  it('GET /webhooks returns 200 with the paginated shape, for the caller tenant only', async () => {
    const response = await new ApiWebhookController().list()(request('/api/v1/webhooks'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((w: any) => w.webhook_id).sort()).toEqual([webhookA1, webhookA2].sort());
    expect(body.data.every((w: any) => w.tenant === tenantA)).toBe(true);
    expect(body.meta?.pagination ?? body.pagination).toMatchObject({ page: 1, limit: 25, total: 2, totalPages: 1 });
  });

  it('GET /webhooks paginates and filters in the model', async () => {
    const service = new WebhookService();

    const first = await service.listWebhooks({} as any, tenantA, 1, 1);
    expect(first.data).toHaveLength(1);
    expect(first.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });

    const second = await service.listWebhooks({} as any, tenantA, 2, 1);
    expect(second.data).toHaveLength(1);
    expect(second.data[0].webhook_id).not.toBe(first.data[0].webhook_id);

    const byEvent = await service.listWebhooks({ event_type: 'ticket.updated' } as any, tenantA, 1, 25);
    expect(byEvent.data.map((w) => w.webhook_id)).toEqual([webhookA2]);
    expect(byEvent.pagination.total).toBe(1);

    const bySearch = await service.listWebhooks({ search: 'ALP' } as any, tenantA, 1, 25);
    expect(bySearch.data.map((w) => w.webhook_id)).toEqual([webhookA1]);
  });

  it('GET /webhooks/{id} returns 200, and 404 for another tenant\'s webhook', async () => {
    const ok = await new ApiWebhookController().getById()(request(`/api/v1/webhooks/${webhookA1}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data).toMatchObject({ webhook_id: webhookA1, name: 'alpha', tenant: tenantA });
    expect(body.data.recent_stats.last_24h).toMatchObject({ total_deliveries: 2, successful_deliveries: 1, failed_deliveries: 1 });

    const foreign = await new ApiWebhookController().getById()(request(`/api/v1/webhooks/${webhookB}`));
    expect(foreign.status).toBe(404);
  });

  it('GET /webhooks/{id}/deliveries returns 200 with a paginated delivery history', async () => {
    const response = await new ApiWebhookController().getDeliveries()(
      request(`/api/v1/webhooks/${webhookA1}/deliveries?page=1&limit=1`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].webhook_id).toBe(webhookA1);
    expect(body.meta?.pagination ?? body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('GET /webhooks/analytics returns 200 counting only the caller tenant', async () => {
    const service = new WebhookService();
    const analytics = await service.getWebhookAnalytics(
      undefined,
      new Date(Date.now() - 3600_000).toISOString(),
      new Date(Date.now() + 3600_000).toISOString(),
      tenantA,
    );
    expect(analytics.data.metrics).toMatchObject({ total_deliveries: 2, successful_deliveries: 1, failed_deliveries: 1 });
  });

  it('GET /webhooks/templates is an empty list; template create/use are 501', async () => {
    const list = await new ApiWebhookController().listTemplates()(request('/api/v1/webhooks/templates'));
    expect(list.status).toBe(200);
    expect((await list.json()).data).toEqual([]);

    const service = new WebhookService();
    await expect(service.createWebhookTemplate({} as any, tenantA)).rejects.toMatchObject({ statusCode: 501 });
    await expect(service.createWebhookFromTemplate(uuidv4(), {}, tenantA)).rejects.toMatchObject({ statusCode: 501 });
  });

  it('deleteWebhook removes only the caller tenant\'s webhook and deliveries', async () => {
    const service = new WebhookService();

    // A tenant-A caller cannot delete tenant B's webhook, even knowing its id.
    await expect(service.deleteWebhook(webhookB, tenantA)).rejects.toMatchObject({ statusCode: 404 });
    expect(await webhookModel.getById(webhookB, tenantB)).not.toBeNull();

    const doomed = (
      await webhookModel.insert({
        tenant: tenantA,
        name: 'doomed',
        url: 'https://example.test/doomed',
        eventTypes: ['ticket.created'],
        signingSecret: 'x',
        createdByUserId: userA,
      })
    ).webhookId;
    await webhookModel.recordDelivery({ tenant: tenantA, webhookId: doomed, eventId: uuidv4(), eventType: 'ticket.created', status: 'delivered' });

    await service.deleteWebhook(doomed, tenantA);

    expect(await webhookModel.getById(doomed, tenantA)).toBeNull();
    expect((await webhookModel.listDeliveries(tenantA, doomed)).total).toBe(0);
    // Tenant B's webhook, its deliveries and its signing secret are untouched, as are A's other rows.
    expect(await webhookModel.getById(webhookB, tenantB)).not.toBeNull();
    expect((await webhookModel.listDeliveries(tenantB, webhookB)).total).toBe(1);
    expect(await webhookModel.getSigningSecret(webhookB, tenantB)).toBe('s3cret');
    expect((await webhookModel.listByTenant(tenantA)).map((w) => w.webhookId).sort()).toEqual([webhookA1, webhookA2].sort());
  });
});

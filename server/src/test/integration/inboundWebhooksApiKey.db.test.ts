/**
 * API-key access to /api/v1/inbound-webhooks/* (alga-2026-0003308).
 *
 * Every route delegates to `withAuth` server actions, which only resolve a
 * caller from the NextAuth session. `runWithApiKeyOrSession` bridges an
 * `x-api-key` identity into them; `handleApiError` maps the AuthenticationError
 * a caller with neither identity gets to 401 instead of 500.
 *
 * Calls the real route handlers with real API keys minted against the test DB.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const h = vi.hoisted(() => ({
  /** What the session lookup returns; null = no session. */
  sessionUser: null as unknown,
  sessionLookups: 0,
}));

// The global test setup replaces the '@alga-psa/auth' barrel with a stand-in that keeps its own
// override storage, which the real withAuth (imported by subpath) never sees. Restore the real
// bridge so the route -> runWithApiKeyOrSession -> withAuth chain is exercised end to end.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

// Only the NextAuth session layer is faked; the real getCurrentUser still honours the
// API-key override ahead of it, and resolves the session user from the DB.
vi.mock('../../../../packages/auth/src/lib/getSession', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSession: vi.fn(async () => {
    h.sessionLookups += 1;
    return h.sessionUser;
  }),
  getSessionWithRevocationCheck: vi.fn(async () => {
    h.sessionLookups += 1;
    return h.sessionUser;
  }),
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  const store = new Map<string, string>();
  // Real provider for app secrets (DB passwords); tenant secrets stay in memory.
  return {
    ...actual,
    getSecretProviderInstance: async () => ({
      getAppSecret: async (name: string) => (await actual.getSecretProviderInstance()).getAppSecret(name),
      getTenantSecret: async (tenant: string, name: string) => store.get(`${tenant}/${name}`),
      setTenantSecret: async (tenant: string, name: string, value: string) => {
        store.set(`${tenant}/${name}`, value);
      },
      deleteTenantSecret: async (tenant: string, name: string) => {
        store.delete(`${tenant}/${name}`);
      },
    }),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const cleanupTenants = new Set<string>();
let db: Knex;

type Fixture = {
  tenantId: string;
  adminKey: string;
  adminUserId: string;
  deniedKey: string;
  webhookId: string;
};

const route = {} as {
  list: typeof import('../../app/api/v1/inbound-webhooks/route');
  actions: typeof import('../../app/api/v1/inbound-webhooks/actions/route');
  detail: typeof import('../../app/api/v1/inbound-webhooks/[id]/route');
  capture: typeof import('../../app/api/v1/inbound-webhooks/[id]/capture-sample/route');
  deliveries: typeof import('../../app/api/v1/inbound-webhooks/[id]/deliveries/route');
  delivery: typeof import('../../app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/route');
  replay: typeof import('../../app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/replay/route');
  rotate: typeof import('../../app/api/v1/inbound-webhooks/[id]/rotate-secret/route');
  test: typeof import('../../app/api/v1/inbound-webhooks/[id]/test/route');
};

function hasColumn(t: string, c: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[t] ?? {}, c);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function tenantRows() {
  return tenantDb(db, '__inbound_webhooks_api_key_fixture__')
    .unscoped('tenants', 'inbound webhooks API-key fixture creates and removes tenants');
}
function schemaTable(name: string) {
  return tenantDb(db, '__inbound_webhooks_api_key_schema__')
    .unscoped(name, 'inbound webhooks API-key test reads schema metadata');
}

async function createUser(tenant: string, label: string): Promise<string> {
  const userId = randomUUID();
  await table(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username: `iw-${label}-${tenant.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Inbound',
    last_name: label,
    ...(hasColumn('users', 'role') ? { role: 'admin' } : {}),
    ...(hasColumn('users', 'email') ? { email: `iw-${label}-${tenant.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  return userId;
}

async function createApiKey(tenant: string, userId: string): Promise<string> {
  const plain = `iw-${randomUUID()}`;
  await table(tenant, 'api_keys').insert({
    tenant,
    api_key_id: randomUUID(),
    user_id: userId,
    api_key: createHash('sha256').update(plain).digest('hex'),
    description: 'Inbound webhooks API-key integration key',
    active: true,
    ...(hasColumn('api_keys', 'usage_count') ? { usage_count: 0 } : {}),
    ...(hasColumn('api_keys', 'purpose') ? { purpose: 'integration_test' } : {}),
    ...(hasColumn('api_keys', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('api_keys', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  return plain;
}

async function grant(tenant: string, userId: string, defs: Array<[string, string]>): Promise<void> {
  const roleId = randomUUID();
  await table(tenant, 'roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Inbound API ${roleId.slice(0, 8)}`,
    description: 'Inbound webhooks API-key role',
    ...(hasColumn('roles', 'msp') ? { msp: true } : {}),
    ...(hasColumn('roles', 'client') ? { client: false } : {}),
  });
  await table(tenant, 'user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  const permissions = defs.map(([resource, action]) => ({
    tenant,
    permission_id: randomUUID(),
    resource,
    action,
    ...(hasColumn('permissions', 'msp') ? { msp: true } : {}),
    ...(hasColumn('permissions', 'client') ? { client: false } : {}),
    ...(hasColumn('permissions', 'description') ? { description: `${action} ${resource}` } : {}),
  }));
  await table(tenant, 'permissions').insert(permissions);
  await table(tenant, 'role_permissions').insert(
    permissions.map((p) => ({ tenant, role_id: roleId, permission_id: p.permission_id })),
  );
}

function webhookBody(slug: string) {
  return {
    name: `Hook ${slug}`,
    slug,
    auth_type: 'bearer',
    auth_config: { type: 'bearer' },
    handler_type: 'direct_action',
    handler_config: { type: 'direct_action', action: 'tickets.create', field_mapping: {} },
  };
}

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Inbound API Key' } : { client_name: 'Inbound API Key' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'product_code') ? { product_code: 'psa' } : {}),
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const adminUserId = await createUser(tenantId, 'admin');
  const deniedUserId = await createUser(tenantId, 'denied');
  await grant(tenantId, adminUserId, [
    ['inbound_webhook', 'read'],
    ['inbound_webhook', 'create'],
    ['inbound_webhook', 'update'],
    ['inbound_webhook', 'delete'],
    ['inbound_webhook', 'replay'],
  ]);
  // The denied user holds an unrelated permission only.
  await grant(tenantId, deniedUserId, [['ticket', 'read']]);

  const adminKey = await createApiKey(tenantId, adminUserId);
  const deniedKey = await createApiKey(tenantId, deniedUserId);

  const webhookId = randomUUID();
  await table(tenantId, 'inbound_webhooks').insert({
    tenant: tenantId,
    inbound_webhook_id: webhookId,
    name: 'Seeded hook',
    slug: `seeded-${webhookId.slice(0, 8)}`,
    auth_type: 'ip_allowlist',
    auth_config: { type: 'ip_allowlist', ip_cidrs: ['10.0.0.0/8'] },
    idempotency_window_seconds: 86400,
    handler_type: 'direct_action',
    handler_config: { type: 'direct_action', action: 'tickets.create', field_mapping: {} },
    is_active: true,
    rate_limit_per_minute: 600,
  });

  return { tenantId, adminKey, adminUserId, deniedKey, webhookId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const safeDelete = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'inbound_webhook_deliveries',
    'inbound_webhooks',
    'api_keys',
    'role_permissions',
    'user_roles',
    'permissions',
    'roles',
    'users',
  ]) {
    await safeDelete(name);
  }
  await tenantRows().where({ tenant }).del().catch(() => undefined);
}

function req(
  path: string,
  init: { method?: string; key?: string | null; tenantId?: string; body?: unknown } = {},
): NextRequest {
  return new NextRequest(`http://localhost/api/v1/inbound-webhooks${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.key ? { 'x-api-key': init.key } : {}),
      ...(init.tenantId ? { 'x-tenant-id': init.tenantId } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any;

describe('/api/v1/inbound-webhooks API-key access', () => {
  let f: Fixture;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'roles', 'permissions', 'api_keys']) {
      columns[name] = await schemaTable(name).columnInfo();
    }
    route.list = await import('../../app/api/v1/inbound-webhooks/route');
    route.actions = await import('../../app/api/v1/inbound-webhooks/actions/route');
    route.detail = await import('../../app/api/v1/inbound-webhooks/[id]/route');
    route.capture = await import('../../app/api/v1/inbound-webhooks/[id]/capture-sample/route');
    route.deliveries = await import('../../app/api/v1/inbound-webhooks/[id]/deliveries/route');
    route.delivery = await import('../../app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/route');
    route.replay = await import('../../app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/replay/route');
    route.rotate = await import('../../app/api/v1/inbound-webhooks/[id]/rotate-secret/route');
    route.test = await import('../../app/api/v1/inbound-webhooks/[id]/test/route');
    f = await seedFixture();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    h.sessionUser = null;
    h.sessionLookups = 0;
  });

  describe('admin API key', () => {
    it('GET /inbound-webhooks lists webhooks (200)', async () => {
      const res = await route.list.GET(req('', { key: f.adminKey, tenantId: f.tenantId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.map((w: any) => w.inboundWebhookId)).toContain(f.webhookId);
    });

    it('GET /inbound-webhooks/actions lists actions (200)', async () => {
      const res = await route.actions.GET(req('/actions', { key: f.adminKey, tenantId: f.tenantId }));
      expect(res.status).toBe(200);
      expect(Array.isArray((await res.json()).data)).toBe(true);
    });

    it('GET /inbound-webhooks/[id] returns the webhook (200)', async () => {
      const res = await route.detail.GET(
        req(`/${f.webhookId}`, { key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(res.status).toBe(200);
    });

    it('POST /inbound-webhooks creates a webhook and returns its secret (201)', async () => {
      const res = await route.list.POST(
        req('', { method: 'POST', key: f.adminKey, tenantId: f.tenantId, body: webhookBody(`created-${randomUUID().slice(0, 8)}`) }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(typeof body.secret).toBe('string');
      expect(body.secret.length).toBeGreaterThan(0);
    });

    it('POST /inbound-webhooks/[id]/rotate-secret rotates a secret (200)', async () => {
      const created = await route.list.POST(
        req('', { method: 'POST', key: f.adminKey, tenantId: f.tenantId, body: webhookBody(`rotate-${randomUUID().slice(0, 8)}`) }),
      );
      const targetId = (await created.json()).data.inboundWebhookId as string;
      const res = await route.rotate.POST(
        req(`/${targetId}/rotate-secret`, { method: 'POST', key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: targetId }),
      );
      expect(res.status).toBe(200);
      expect(typeof (await res.json()).secret).toBe('string');
    });

    it('DELETE /inbound-webhooks/[id] deletes a webhook (204)', async () => {
      const created = await route.list.POST(
        req('', { method: 'POST', key: f.adminKey, tenantId: f.tenantId, body: webhookBody(`delete-${randomUUID().slice(0, 8)}`) }),
      );
      const id = (await created.json()).data.inboundWebhookId as string;
      const res = await route.detail.DELETE(
        req(`/${id}`, { method: 'DELETE', key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id }),
      );
      expect(res.status).toBe(204);
    });

    it('GET /inbound-webhooks/[id]/deliveries lists deliveries (200)', async () => {
      const res = await route.deliveries.GET(
        req(`/${f.webhookId}/deliveries`, { key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(res.status).toBe(200);
    });

    it('unknown delivery on GET [deliveryId] and replay is a 404, not an auth failure', async () => {
      const deliveryId = randomUUID();
      const get = await route.delivery.GET(
        req(`/${f.webhookId}/deliveries/${deliveryId}`, { key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId, deliveryId }),
      );
      expect(get.status).toBe(404);
      const replay = await route.replay.POST(
        req(`/${f.webhookId}/deliveries/${deliveryId}/replay`, { method: 'POST', key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId, deliveryId }),
      );
      expect(replay.status).toBe(404);
    });

    it('capture-sample POST/DELETE resolve the caller (200)', async () => {
      const post = await route.capture.POST(
        req(`/${f.webhookId}/capture-sample`, { method: 'POST', key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(post.status).toBe(200);
      const del = await route.capture.DELETE(
        req(`/${f.webhookId}/capture-sample`, { method: 'DELETE', key: f.adminKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(del.status).toBe(200);
    });
  });

  describe('no identity', () => {
    it('no key and no session is 401 on every route, never 500', async () => {
      const id = f.webhookId;
      const deliveryId = randomUUID();
      const responses = await Promise.all([
        route.list.GET(req('')),
        route.list.POST(req('', { method: 'POST', body: webhookBody('x-noauth') })),
        route.actions.GET(req('/actions')),
        route.detail.GET(req(`/${id}`), ctx({ id })),
        route.detail.PUT(req(`/${id}`, { method: 'PUT', body: webhookBody('x-noauth') }), ctx({ id })),
        route.detail.DELETE(req(`/${id}`, { method: 'DELETE' }), ctx({ id })),
        route.capture.POST(req(`/${id}/capture-sample`, { method: 'POST' }), ctx({ id })),
        route.capture.DELETE(req(`/${id}/capture-sample`, { method: 'DELETE' }), ctx({ id })),
        route.deliveries.GET(req(`/${id}/deliveries`), ctx({ id })),
        route.delivery.GET(req(`/${id}/deliveries/${deliveryId}`), ctx({ id, deliveryId })),
        route.replay.POST(req(`/${id}/deliveries/${deliveryId}/replay`, { method: 'POST' }), ctx({ id, deliveryId })),
        route.rotate.POST(req(`/${id}/rotate-secret`, { method: 'POST' }), ctx({ id })),
        route.test.POST(req(`/${id}/test`, { method: 'POST', body: {} }), ctx({ id })),
      ]);
      expect(responses.map((r) => r.status)).toEqual(Array(13).fill(401));
      expect((await responses[0].json()).error.code).toBe('UNAUTHORIZED');
    });

    it('an unknown API key is 401', async () => {
      const res = await route.list.GET(req('', { key: `iw-${randomUUID()}`, tenantId: f.tenantId }));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('permissions', () => {
    it('a valid key without inbound_webhook permissions gets 403', async () => {
      const read = await route.list.GET(req('', { key: f.deniedKey, tenantId: f.tenantId }));
      expect(read.status).toBe(403);

      const create = await route.list.POST(
        req('', { method: 'POST', key: f.deniedKey, tenantId: f.tenantId, body: webhookBody('denied-create') }),
      );
      expect(create.status).toBe(403);

      const rotate = await route.rotate.POST(
        req(`/${f.webhookId}/rotate-secret`, { method: 'POST', key: f.deniedKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(rotate.status).toBe(403);

      const del = await route.detail.DELETE(
        req(`/${f.webhookId}`, { method: 'DELETE', key: f.deniedKey, tenantId: f.tenantId }),
        ctx({ id: f.webhookId }),
      );
      expect(del.status).toBe(403);
    });
  });

  describe('session regression', () => {
    it('a request without x-api-key still resolves the caller through the session path', async () => {
      h.sessionUser = {
        user: { id: f.adminUserId, tenant: f.tenantId, user_type: 'internal' },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      };
      const res = await route.list.GET(req(''));
      expect(h.sessionLookups).toBeGreaterThan(0);
      // The session user is resolved (not 401); permission is decided by the real RBAC lookup.
      expect(res.status).toBe(200);
    });
  });
});

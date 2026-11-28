import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTestApiKey } from '../e2e/utils/apiTestHelpers';
import { createRegistry } from '../../lib/api/openapi/registry';
import { registerAssetRoutes } from '../../lib/api/openapi/routes/assets';
import { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } from '@alga-psa/authorization/bundles/service';

/**
 * GET /api/v1/assets/stats through the real route handler (API-key auth, RBAC, read authorization,
 * per-record projection, reprojection) against the migrated schema. The route once 500ed on a nonexistent
 * purchase_price column; value is now grouped by purchase_cost_currency and never summed across currencies.
 */
const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined, tenant: '' }));

// The route, API-key validator, RBAC, authorization kernel, and AssetService
// remain real. Only the connection factories point at the disposable DB txn.
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  getAdminConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant }),
}));
vi.mock('@alga-psa/db/admin', async (original) => ({
  ...await original<typeof import('@alga-psa/db/admin')>(),
  getAdminConnection: async () => connection.db!,
}));
vi.mock('@/lib/db/db', async (original) => ({
  ...await original<typeof import('@/lib/db/db')>(),
  getConnection: async () => connection.db!,
}));
vi.mock('../../../../packages/db/src/lib/tenant', async (original) => ({
  ...await original<typeof import('../../../../packages/db/src/lib/tenant')>(),
  createTenantKnex: async () => ({ knex: connection.db!, tenant: connection.tenant }),
}));
vi.mock('@alga-psa/auth', async () => {
  const { ApiKeyService, shouldTouchApiKeyLastUsed } = await import('../../../../packages/auth/src/services/apiKeyService');
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return { ...actual, ApiKeyService, shouldTouchApiKeyLastUsed };
});
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

let db: Knex;
let tenant: string;
const cleanupTenants = new Set<string>();
let statsGet: typeof import('../../app/api/v1/assets/stats/route').GET;
const TENANT_DEFAULT_CURRENCY = 'GBP';

const table = (name: string) => tenantDb(connection.db!, tenant).table(name);
const schema = (name: string) => tenantDb(db, '__asset_stats_route_schema__').unscoped(name, 'asset stats route schema inspection');

async function createCaller() {
  const userId = randomUUID();
  await table('users').insert({
    tenant, user_id: userId, username: `asset-stats-${userId}`, email: `${userId}@example.test`,
    first_name: 'Stats', last_name: 'Caller', hashed_password: 'not-used', user_type: 'internal', is_inactive: false,
  });
  const roleId = randomUUID();
  await table('roles').insert({ tenant, role_id: roleId, role_name: `Asset Stats ${roleId}`, msp: true, client: false });
  await table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  let permission = await table('permissions').where({ resource: 'asset', action: 'read' }).first('permission_id');
  if (!permission) {
    const permissionId = randomUUID();
    [permission] = await table('permissions').insert({ tenant, permission_id: permissionId, resource: 'asset', action: 'read', msp: true, client: false }).returning('permission_id');
  }
  await table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id }).onConflict(['tenant', 'role_id', 'permission_id']).ignore();
  const key = await createTestApiKey(connection.db!, userId, tenant, `asset-stats-${userId}`);
  return { userId, apiKey: key.api_key, apiKeyId: key.api_key_id };
}

async function grantRedactingBundle(caller: { userId: string; apiKeyId: string }, clientId: string, redactedFields: string[]) {
  const bundle = await createAuthorizationBundle(connection.db!, { tenant, name: `Asset stats ${randomUUID()}`, actorUserId: caller.userId });
  await upsertBundleRule(connection.db!, {
    tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
    resourceType: 'asset', action: 'read', templateKey: 'selected_clients',
    config: { selectedClientIds: [clientId], redactedFields }, actorUserId: caller.userId,
  });
  await publishBundleRevision(connection.db! as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: caller.userId });
  await createBundleAssignment(connection.db!, {
    tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: caller.apiKeyId, actorUserId: caller.userId,
  });
}

async function seed(seeds: Array<{ cost: number | null; currency: string | null }>) {
  const clientId = randomUUID();
  await table('clients').insert({ tenant, client_id: clientId, client_name: `Stats client ${clientId}` });
  await table('asset_statuses').insert({ tenant, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 }).onConflict(['tenant', 'slug']).ignore();
  await table('default_billing_settings').insert({ tenant, default_currency_code: TENANT_DEFAULT_CURRENCY })
    .onConflict('tenant').merge({ default_currency_code: TENANT_DEFAULT_CURRENCY });
  if (seeds.length) await insertTestAssets(connection.db!, seeds.map((s, i) => ({
    tenant, client_id: clientId, asset_tag: `STATS-${i}-${randomUUID().slice(0, 8)}`, name: `Stats fixture ${i}`,
    status: 'active', asset_type: 'workstation', purchase_cost: s.cost, purchase_cost_currency: s.currency,
    created_at: db.fn.now(), updated_at: db.fn.now(),
  })));
  return clientId;
}

// The documented 200 response for this route, taken from the OpenAPI source the published spec is generated from.
function documentedStatsResponse() {
  const registry = createRegistry();
  registerAssetRoutes(registry);
  const route = registry.getRegisteredRoutes().find((r) => r.method === 'get' && r.path === '/api/v1/assets/stats');
  return (route!.responses as any)[200].schema as import('zod').ZodObject<any>;
}

/** Every 200 body must parse under the documented schema and carry no undocumented statistics field. */
function expectMatchesOpenApi(body: any) {
  const schema = documentedStatsResponse();
  const parsed = schema.safeParse(body);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  const documented = Object.keys((schema.shape.data as import('zod').ZodObject<any>).shape);
  expect(Object.keys(body.data).filter((key) => !documented.includes(key))).toEqual([]);
}

async function getStats(caller: { apiKey: string }) {
  const req = new NextRequest('http://localhost/api/v1/assets/stats', {
    headers: { 'x-api-key': caller.apiKey, 'x-tenant-id': tenant },
  });
  const response = await (statsGet as Function)(req, { params: Promise.resolve({}) });
  const body = await response.json();
  if (response.status === 200) expectMatchesOpenApi(body);
  return { status: response.status as number, body };
}

async function tenantRowFor(id: string, name: string) {
  const row: Record<string, unknown> = { tenant: id, company_name: name, email: `${id}@example.test`, product_code: 'psa', created_at: db.fn.now(), updated_at: db.fn.now() };
  const cols = await schema('tenants').columnInfo();
  if (!('company_name' in cols)) { delete row.company_name; row.client_name = name; }
  if (!('product_code' in cols)) delete row.product_code;
  return row;
}

beforeAll(async () => {
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
  process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
  db = await createTestDbConnection({ runSeeds: false });
  ({ GET: statsGet } = await import('../../app/api/v1/assets/stats/route'));
}, 180_000);

beforeEach(async () => {
  tenant = randomUUID();
  connection.tenant = tenant;
  cleanupTenants.add(tenant);
  await tenantDb(db, '__asset_stats_route_fixture__').unscoped('tenants', 'create asset stats route tenant')
    .insert(await tenantRowFor(tenant, 'Asset stats route'));
  connection.db = await db.transaction();
});

afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => {
  for (const id of cleanupTenants) await tenantDb(db, id).unscoped('tenants', 'remove asset stats route fixture tenant').where({ tenant: id }).del().catch(() => undefined);
  await db?.destroy();
});

describe('GET /api/v1/assets/stats value fields through the real route', () => {
  it('returns 200 and one total when every valued asset shares a currency (null cost ignored)', async () => {
    const caller = await createCaller();
    await seed([{ cost: 100, currency: 'EUR' }, { cost: 250, currency: 'EUR' }, { cost: null, currency: null }]);
    const { status, body } = await getStats(caller);
    expect(status).toBe(200);
    expect(body.data.total_assets).toBe(3);
    expect(body.data.asset_value_by_currency).toEqual({ EUR: 350 });
    expect(body.data.total_asset_value).toBe(350);
    expect(body.data.total_asset_value_currency).toBe('EUR');
  }, 180_000);

  it('omits the single total when currencies are mixed', async () => {
    const caller = await createCaller();
    await seed([{ cost: 100, currency: 'USD' }, { cost: 100, currency: 'EUR' }, { cost: null, currency: null }]);
    const { status, body } = await getStats(caller);
    expect(status).toBe(200);
    expect(body.data.asset_value_by_currency).toEqual({ USD: 100, EUR: 100 });
    expect(body.data).not.toHaveProperty('total_asset_value');
    expect(body.data).not.toHaveProperty('total_asset_value_currency');
  }, 180_000);

  it('counts a null-currency asset under the tenant default currency', async () => {
    const caller = await createCaller();
    await seed([{ cost: 40, currency: null }, { cost: 60, currency: TENANT_DEFAULT_CURRENCY }, { cost: null, currency: null }]);
    const { status, body } = await getStats(caller);
    expect(status).toBe(200);
    expect(body.data.asset_value_by_currency).toEqual({ [TENANT_DEFAULT_CURRENCY]: 100 });
    expect(body.data.total_asset_value).toBe(100);
    expect(body.data.total_asset_value_currency).toBe(TENANT_DEFAULT_CURRENCY);
  }, 180_000);

  it('reports a zero total in the tenant default currency when no asset is valued', async () => {
    const caller = await createCaller();
    await seed([]);
    const { status, body } = await getStats(caller);
    expect(status).toBe(200);
    expect(body.data.total_assets).toBe(0);
    expect(body.data.asset_value_by_currency).toEqual({});
    expect(body.data.total_asset_value).toBe(0);
    expect(body.data.total_asset_value_currency).toBe(TENANT_DEFAULT_CURRENCY);
  }, 180_000);

  it("does not count another tenant's assets", async () => {
    const caller = await createCaller();
    await seed([{ cost: 100, currency: 'EUR' }]);
    const ownTenant = tenant;
    const otherTenant = randomUUID();
    await tenantDb(connection.db!, '__asset_stats_route_fixture__').unscoped('tenants', 'create other asset stats tenant')
      .insert(await tenantRowFor(otherTenant, 'Other asset stats tenant'));
    tenant = otherTenant;
    try { await seed([{ cost: 9_999, currency: 'EUR' }, { cost: 1, currency: 'USD' }]); } finally { tenant = ownTenant; }
    const { status, body } = await getStats(caller);
    expect(status).toBe(200);
    expect(body.data.total_assets).toBe(1);
    expect(body.data.asset_value_by_currency).toEqual({ EUR: 100 });
    expect(body.data.total_asset_value).toBe(100);
  }, 180_000);

  it.each(['purchase_cost', 'purchase_cost_currency'])('omits every value field when %s is redacted for the caller', async (field) => {
    const caller = await createCaller();
    const clientId = await seed([{ cost: 100, currency: 'EUR' }, { cost: 250, currency: 'EUR' }]);
    await grantRedactingBundle(caller, clientId, [field]);
    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const { status, body } = await getStats(caller);
      expect(status).toBe(200);
      expect(body.data.total_assets).toBe(2);
      expect(body.data).not.toHaveProperty('asset_value_by_currency');
      expect(body.data).not.toHaveProperty('total_asset_value');
      expect(body.data).not.toHaveProperty('total_asset_value_currency');
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);
});

/**
 * GET /api/v1/assets/stats value aggregation against the real assets schema.
 *
 * The route once summed a nonexistent assets.purchase_price column (Postgres 42703 -> 500); a mocked unit
 * test could not notice. These cases run both statistics paths (the SQL getStatistics and the projection
 * based getStatisticsFromProjections the route uses) against a migrated Postgres and assert that value is
 * grouped by purchase_cost_currency and never added across currencies.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: fixtureTenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let fixtureTenant = '';
let AssetService: typeof import('../../lib/api/services/AssetService').AssetService;
let insertTestAssets: typeof import('../../../../shared/test-utils/assetFixtures').insertTestAssets;
const TENANT_DEFAULT_CURRENCY = 'GBP';
const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_stats_fixture__').unscoped(name, 'asset extension integration fixture');
}

type Fixture = { tenantId: string; userId: string; clientId: string; ctx: any };

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  fixtureTenant = tenantId;
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Stats PSA' } : { client_name: 'Asset Stats PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `stats-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Asset',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `stats-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Emerald City',
    ...(hasColumn('clients', 'billing_email') ? { billing_email: 'ops@emerald.example' } : {}),
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  // A tenant made straight in SQL misses the status registry real tenants get
  // from the migration, and asset writes validate against it.
  await table(tenantId, 'asset_statuses').insert([
    { tenant: tenantId, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
  ]);

  // The tenant default currency, used for assets that carry no currency of their own.
  await table(tenantId, 'default_billing_settings').insert({
    tenant: tenantId, default_currency_code: TENANT_DEFAULT_CURRENCY,
  }).catch(async () => {
    await table(tenantId, 'default_billing_settings').update({ default_currency_code: TENANT_DEFAULT_CURRENCY });
  });

  // A reader with the asset:read permission through a role, the way a real MSP staff caller is authorized.
  const roleId = randomUUID();
  await table(tenantId, 'roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Stats reader ${roleId}`, msp: true, client: false });
  await table(tenantId, 'user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
  const permission = await table(tenantId, 'permissions').where({ resource: 'asset', action: 'read', msp: true }).first('permission_id');
  const permissionId = permission?.permission_id ?? randomUUID();
  if (!permission) {
    await table(tenantId, 'permissions').insert({ tenant: tenantId, permission_id: permissionId, resource: 'asset', action: 'read', msp: true, client: false });
  }
  await table(tenantId, 'role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permissionId });
  const user = { user_id: userId, user_type: 'internal', tenant: tenantId, role_ids: [roleId] };

  return { tenantId, userId, clientId, ctx: { tenant: tenantId, userId, user, db } };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['assets', 'asset_tag_claims', 'default_billing_settings', 'role_permissions', 'user_roles', 'roles', 'asset_statuses', 'clients', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

type Seed = { cost: number | null; currency: string | null };

async function seedAssets(fx: Fixture, seeds: Seed[]): Promise<void> {
  await insertTestAssets(db, seeds.map((seed, index) => ({
    tenant: fx.tenantId,
    client_id: fx.clientId,
    asset_tag: `STATS-${index}-${randomUUID().slice(0, 8)}`,
    asset_type: 'workstation',
    name: `Stats fixture ${index}`,
    status: 'active',
    purchase_cost: seed.cost,
    purchase_cost_currency: seed.currency,
  })));
}

/** Both statistics paths, as the REST route (projections) and the SQL service method compute them. */
async function bothPaths(fx: Fixture) {
  const service = new AssetService();
  const sql = await service.getStatistics(fx.ctx);
  const listed = await service.list({ page: 1, limit: 100 }, fx.ctx);
  const projected = service.getStatisticsFromProjections(
    listed.data, [], new Date(), await service.getTenantDefaultCurrency(fx.ctx),
  );
  return { sql, projected };
}
const valueFields = (stats: Record<string, any>) => ({
  asset_value_by_currency: stats.asset_value_by_currency,
  total_asset_value: stats.total_asset_value,
  total_asset_value_currency: stats.total_asset_value_currency,
});

describe('GET /assets/stats value aggregation against the real schema (integration)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_stats_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ AssetService } = await import('../../lib/api/services/AssetService'));
    ({ insertTestAssets } = await import('../../../../shared/test-utils/assetFixtures'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('answers without a 42703 and reports one currency as a single total (null cost ignored)', async () => {
    const fx = await seedFixture();
    await seedAssets(fx, [
      { cost: 100, currency: 'EUR' },
      { cost: 250, currency: 'EUR' },
      { cost: null, currency: null },
    ]);

    const { sql, projected } = await bothPaths(fx);
    for (const stats of [sql, projected]) {
      expect(stats.total_assets).toBe(3);
      expect(valueFields(stats)).toEqual({
        asset_value_by_currency: { EUR: 350 },
        total_asset_value: 350,
        total_asset_value_currency: 'EUR',
      });
    }
  }, HOOK_TIMEOUT);

  it('never adds across currencies: mixed currencies omit the single total', async () => {
    const fx = await seedFixture();
    await seedAssets(fx, [
      { cost: 100, currency: 'USD' },
      { cost: 100, currency: 'EUR' },
      { cost: null, currency: null },
    ]);

    const { sql, projected } = await bothPaths(fx);
    for (const stats of [sql, projected]) {
      expect(stats.asset_value_by_currency).toEqual({ USD: 100, EUR: 100 });
      expect(stats).not.toHaveProperty('total_asset_value');
      expect(stats).not.toHaveProperty('total_asset_value_currency');
    }
  }, HOOK_TIMEOUT);

  it('counts a null-currency asset under the tenant default currency', async () => {
    const fx = await seedFixture();
    await seedAssets(fx, [
      { cost: 40, currency: null },
      { cost: 60, currency: TENANT_DEFAULT_CURRENCY },
      { cost: null, currency: null },
    ]);

    const { sql, projected } = await bothPaths(fx);
    for (const stats of [sql, projected]) {
      expect(valueFields(stats)).toEqual({
        asset_value_by_currency: { [TENANT_DEFAULT_CURRENCY]: 100 },
        total_asset_value: 100,
        total_asset_value_currency: TENANT_DEFAULT_CURRENCY,
      });
    }
  }, HOOK_TIMEOUT);
});

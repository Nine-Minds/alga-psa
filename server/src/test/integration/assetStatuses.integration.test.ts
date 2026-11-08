/**
 * alga-2026-0002672 — asset status registry (FR-B1 to FR-B6).
 *
 * Real-DB coverage: the seed migration's five builtins plus a custom status for
 * a pre-existing free-text value (T021), slug validation on create/update
 * (T023/T024), and archive-with-in-use-count (T026/T027/T028).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue(true),
    withAuth: (action: any) => async (...args: unknown[]) => action(
      { user_id: actionAuth.userId },
      { tenant: actionAuth.tenant },
      ...args,
    ),
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: actionAuth.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let createAsset: typeof import('@alga-psa/assets/actions/assetActions').createAsset;
let updateAsset: typeof import('@alga-psa/assets/actions/assetActions').updateAsset;
let assetActionErrorFrom: typeof import('@alga-psa/assets/actions/assetActionErrors').assetActionErrorFrom;
let listAssetStatuses: typeof import('@alga-psa/assets/actions/assetStatusActions').listAssetStatuses;
let createAssetStatus: typeof import('@alga-psa/assets/actions/assetStatusActions').createAssetStatus;
let archiveAssetStatus: typeof import('@alga-psa/assets/actions/assetStatusActions').archiveAssetStatus;
let updateAssetStatus: typeof import('@alga-psa/assets/actions/assetStatusActions').updateAssetStatus;
let restoreAssetStatus: typeof import('@alga-psa/assets/actions/assetStatusActions').restoreAssetStatus;

const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_status_fixture__').unscoped(name, 'asset status integration fixture');
}

/** Builtins are seeded for existing tenants only, so a test tenant seeds its own. */
const BUILTINS = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'in_stock', label: 'In stock', kind: 'deployable', display_order: 1 },
  { slug: 'maintenance', label: 'In maintenance', kind: 'pending', display_order: 2 },
  { slug: 'inactive', label: 'Inactive', kind: 'undeployable', display_order: 3 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

async function seedTenant(): Promise<{ tenantId: string; userId: string; clientId: string }> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Status PSA' } : { client_name: 'Asset Status PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `status-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Status',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `status-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Asset Status Client',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await table(tenantId, 'asset_statuses')
    .insert(BUILTINS.map((status) => ({ tenant: tenantId, ...status, is_builtin: true, is_active: true })));

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, clientId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['asset_history', 'workstation_assets', 'assets', 'asset_statuses', 'clients', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

const baseAsset = (clientId: string, status = 'active') => ({
  asset_type: 'unknown',
  client_id: clientId,
  asset_tag: `TAG-${randomUUID().slice(0, 8)}`,
  name: 'Fixture device',
  status,
  location_id: null,
});

describe('asset statuses', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients', 'asset_statuses']) {
      columns[name] = await tenantDb(db, '__asset_status_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ createAsset, updateAsset } = await import('@alga-psa/assets/actions/assetActions'));
    ({ assetActionErrorFrom } = await import('@alga-psa/assets/actions/assetActionErrors'));
    ({ listAssetStatuses, createAssetStatus, archiveAssetStatus, updateAssetStatus, restoreAssetStatus } =
      await import('@alga-psa/assets/actions/assetStatusActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // T021
  it('seeds the five builtins for every existing tenant with the expected kinds', async () => {
    const existing = await unscoped('tenants').select('tenant').limit(3);
    expect(existing.length).toBeGreaterThan(0);
    for (const row of existing) {
      const slugs = await table(row.tenant, 'asset_statuses').where({ is_builtin: true }).pluck('slug');
      for (const builtin of BUILTINS) {
        expect(slugs, `tenant ${row.tenant} missing ${builtin.slug}`).toContain(builtin.slug);
      }
    }

    const kinds = await unscoped('asset_statuses').distinct('kind').pluck('kind');
    for (const kind of kinds) {
      expect(['deployable', 'pending', 'undeployable', 'archived']).toContain(kind);
    }
  });

  // T021 (custom value preservation) + T023
  it('accepts a custom active slug and rejects an unknown one', async () => {
    const { tenantId, clientId } = await seedTenant();
    await table(tenantId, 'asset_statuses').insert({
      tenant: tenantId,
      slug: 'in_repair',
      label: 'In repair',
      kind: 'undeployable',
      is_builtin: false,
      is_active: true,
      display_order: 9,
    });

    const created: any = await createAsset(baseAsset(clientId, 'in_repair') as any);
    expect(assetActionErrorFrom(created)).toBeNull();
    expect(created.status).toBe('in_repair');

    // An unknown slug throws the validation payload the form reads; the UI maps
    // the throw back through assetActionErrorFrom.
    const rejected = await createAsset(baseAsset(clientId, 'not_a_status') as any)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toContain('unknown_status');
    expect(assetActionErrorFrom(rejected)).not.toBeNull();
  });

  // T024
  it('keeps an archived status unchanged but refuses switching to one', async () => {
    const { tenantId, clientId } = await seedTenant();
    await table(tenantId, 'asset_statuses').insert({
      tenant: tenantId,
      slug: 'legacy_state',
      label: 'Legacy state',
      kind: 'undeployable',
      is_builtin: false,
      is_active: true,
      display_order: 9,
    });
    const created: any = await createAsset(baseAsset(clientId, 'legacy_state') as any);
    await table(tenantId, 'asset_statuses').where({ slug: 'legacy_state' }).update({ is_active: false });

    // Editing another field while the archived status stays put is allowed.
    const renamed: any = await updateAsset(created.asset_id, { name: 'Renamed', status: 'legacy_state' } as any);
    expect(assetActionErrorFrom(renamed)).toBeNull();

    const onActive: any = await createAsset(baseAsset(clientId, 'active') as any);
    const switched: any = await updateAsset(onActive.asset_id, { status: 'legacy_state' } as any);
    expect(assetActionErrorFrom(switched)).not.toBeNull();
  });

  // T026 / T028
  it('refuses to archive a status in use and reports the count', async () => {
    const { tenantId, clientId } = await seedTenant();
    await createAsset(baseAsset(clientId, 'maintenance') as any);
    await createAsset(baseAsset(clientId, 'maintenance') as any);

    const statuses = await listAssetStatuses({ includeArchived: true, withUsage: true }) as any[];
    const maintenance = statuses.find((status) => status.slug === 'maintenance');
    expect(maintenance.in_use_count).toBe(2);

    const blocked: any = await archiveAssetStatus(maintenance.status_id);
    expect(blocked.success).toBe(false);
    expect(blocked.error.code).toBe('status_in_use');
    expect(blocked.error.inUseCount).toBe(2);

    const unused = statuses.find((status) => status.slug === 'in_stock');
    const archived: any = await archiveAssetStatus(unused.status_id);
    expect(archived.success).toBe(true);
    const row = await table(tenantId, 'asset_statuses').where({ slug: 'in_stock' }).first();
    expect(row.is_active).toBe(false);
  });

  // FR-B4: archive is not delete, so an archived status has a way back. It
  // had none: the list greyed it out with only Rename, and re-creating it by
  // name came back as duplicate_slug.
  it('restores an archived status, by action or by re-creating it', async () => {
    const { tenantId } = await seedTenant();
    const statuses = await listAssetStatuses() as any[];
    const inStock = statuses.find((status) => status.slug === 'in_stock');

    expect((await archiveAssetStatus(inStock.status_id) as any).success).toBe(true);
    const restored: any = await restoreAssetStatus(inStock.status_id);
    expect(restored.success).toBe(true);
    expect(restored.data.is_active).toBe(true);
    expect((await table(tenantId, 'asset_statuses').where({ slug: 'in_stock' }).first()).is_active).toBe(true);

    // Re-creating by name brings the archived row back rather than failing.
    const created: any = await createAssetStatus({ label: 'Loaner QA', kind: 'pending' });
    expect(created.success).toBe(true);
    expect((await archiveAssetStatus(created.data.status_id) as any).success).toBe(true);

    const recreated: any = await createAssetStatus({ label: 'Loaner QA', kind: 'undeployable' });
    expect(recreated.success).toBe(true);
    expect(recreated.data.status_id).toBe(created.data.status_id);
    expect(recreated.data.is_active).toBe(true);
    expect(recreated.data.kind).toBe('undeployable');
    expect(await table(tenantId, 'asset_statuses').where({ slug: 'loaner_qa' }).count('* as count').first())
      .toMatchObject({ count: '1' });
  });

  // T027
  it('rejects a duplicate slug in the tenant but allows it in another tenant', async () => {
    const first = await seedTenant();
    const created: any = await createAssetStatus({ label: 'In repair', kind: 'pending' });
    expect(created.success).toBe(true);
    expect(created.data.slug).toBe('in_repair');

    const duplicate: any = await createAssetStatus({ label: 'In repair', kind: 'pending' });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error.code).toBe('duplicate_slug');

    await seedTenant();
    const otherTenant: any = await createAssetStatus({ label: 'In repair', kind: 'pending' });
    expect(otherTenant.success).toBe(true);
    expect(first.tenantId).not.toBe(actionAuth.tenant);
  });

  // A status change on a workstation asset re-writes the whole extension row,
  // including the jsonb `installed_software` list. node-pg renders a bare JS
  // array as a Postgres array literal, which the json parser rejects with
  // 22P02, so a synced device with real software could not be saved at all.
  it('saves a status change on a workstation carrying installed software', async () => {
    const { tenantId, clientId } = await seedTenant();
    const software = [
      { name: 'Google Chrome', version: '128.0.6613.120' },
      { name: 'Microsoft 365 Apps', version: '16.0.17928' },
    ];

    const created: any = await createAsset({
      ...baseAsset(clientId, 'active'),
      asset_type: 'workstation',
      workstation: {
        os_type: 'Windows',
        os_version: 'Windows 11 Pro 23H2',
        cpu_model: 'Intel Core i5-1240P',
        cpu_cores: 12,
        ram_gb: 16,
        storage_type: 'NVMe SSD',
        storage_capacity_gb: 512,
        installed_software: software,
      },
    } as any);
    expect(assetActionErrorFrom(created)).toBeNull();

    // The list round-trips as a jsonb array, not an array literal and not the
    // `{}` an empty array used to degrade into.
    const inserted = await table(tenantId, 'workstation_assets').where({ asset_id: created.asset_id }).first();
    expect(inserted.installed_software).toEqual(software);

    const updated: any = await updateAsset(created.asset_id, {
      status: 'maintenance',
      workstation: { installed_software: software },
    } as any);
    expect(assetActionErrorFrom(updated)).toBeNull();
    expect(updated.status).toBe('maintenance');

    const after = await table(tenantId, 'workstation_assets').where({ asset_id: created.asset_id }).first();
    expect(after.installed_software).toEqual(software);
  });

  // T028: builtins are renameable, and nothing exposes a delete.
  it('renames a builtin status without touching its slug', async () => {
    await seedTenant();
    const statuses = await listAssetStatuses() as any[];
    const active = statuses.find((status) => status.slug === 'active');

    const renamed: any = await updateAssetStatus(active.status_id, { label: 'In use' });
    expect(renamed.success).toBe(true);
    expect(renamed.data.label).toBe('In use');
    expect(renamed.data.slug).toBe('active');
    expect(renamed.data.is_builtin).toBe(true);

    const actions = await import('@alga-psa/assets/actions/assetStatusActions');
    expect(Object.keys(actions)).not.toContain('deleteAssetStatus');
  });

  // FR-B4: the dragged order is what every status select reads, so the whole
  // order is rewritten as 0..n-1 rather than swapped pairwise.
  it('writes a dragged order and refuses a stale one', async () => {
    await seedTenant();
    const { reorderAssetStatuses } = await import('@alga-psa/assets/actions/assetStatusActions');
    const before = await listAssetStatuses({ includeArchived: true }) as any[];
    const reversed = [...before].reverse().map((status) => status.status_id);

    const result: any = await reorderAssetStatuses(reversed);
    expect(result.success).toBe(true);
    expect(result.data.map((status: any) => status.status_id)).toEqual(reversed);
    expect(result.data.map((status: any) => status.display_order)).toEqual([0, 1, 2, 3, 4]);

    // The list action reads display_order, so the new order is what forms see.
    const after = await listAssetStatuses({ includeArchived: true }) as any[];
    expect(after.map((status) => status.status_id)).toEqual(reversed);

    // A list naming a status this tenant does not have renumbers nothing.
    const stale: any = await reorderAssetStatuses([...reversed.slice(1), randomUUID()]);
    expect(stale.success).toBe(false);
    expect(stale.error.code).toBe('not_found');
    const unchanged = await listAssetStatuses({ includeArchived: true }) as any[];
    expect(unchanged.map((status) => status.status_id)).toEqual(reversed);
  });

  // FR-B5: what "deployed" means to a metric, including a tenant whose
  // registry has not been seeded (which must not read as "nothing deployed").
  it('lists the deployable slugs and falls back to the builtins', async () => {
    const { tenantId } = await seedTenant();
    const { listDeployableStatusSlugs } = await import('@alga-psa/assets/lib/assetStatusRegistry');

    await table(tenantId, 'asset_statuses').insert({
      tenant: tenantId,
      slug: 'on_loan',
      label: 'On loan',
      kind: 'deployable',
      is_builtin: false,
      is_active: true,
      display_order: 9,
    });

    const slugs = await listDeployableStatusSlugs(db, tenantId);
    expect([...slugs].sort()).toEqual(['active', 'in_stock', 'on_loan']);
    expect(slugs).not.toContain('maintenance');
    expect(slugs).not.toContain('inactive');

    // A tenant with no registry rows at all — never emptying a seeded tenant,
    // which the builtin-seed test scans.
    const unseeded = randomUUID();
    expect([...(await listDeployableStatusSlugs(db, unseeded))].sort()).toEqual(['active', 'in_stock']);
  });
});

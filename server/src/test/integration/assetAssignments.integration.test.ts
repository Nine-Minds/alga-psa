/**
 * alga-2026-0002672 — assignment history (FR-C1 to FR-C8).
 *
 * Real-DB coverage for the single write helper: assign, reassign, unassign,
 * no-op and cross-client rejection (T037-T041), the writers that route through
 * it (T042-T044), contact deletion closing open rows (T047), and the read
 * actions (T048/T049).
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
let bulkUpdateAssets: typeof import('@alga-psa/assets/actions/assetActions').bulkUpdateAssets;
let assetActionErrorFrom: typeof import('@alga-psa/assets/actions/assetActionErrors').assetActionErrorFrom;
let getAssetAssignments: typeof import('@alga-psa/assets/actions/assetAssignmentActions').getAssetAssignments;
let getContactAssignedAssets: typeof import('@alga-psa/assets/actions/assetAssignmentActions').getContactAssignedAssets;
let setAssetAssignee: typeof import('@alga-psa/shared/models/assetAssignmentModel').setAssetAssignee;
let clearContactLinksBeforeDelete: typeof import('@alga-psa/shared/models/contactModel').clearContactLinksBeforeDelete;

const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_assignment_fixture__').unscoped(name, 'asset assignment integration fixture');
}

const BUILTIN_STATUSES = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

type Fixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  otherClientId: string;
  contactA: string;
  contactB: string;
  otherClientContact: string;
};

async function seedTenant(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Assignment PSA' } : { client_name: 'Assignment PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `assign-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Alex',
    last_name: 'Tech',
    ...(hasColumn('users', 'email') ? { email: `assign-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  const otherClientId = randomUUID();
  for (const [id, name] of [[clientId, 'Acme Corp'], [otherClientId, 'Other Corp']] as const) {
    await table(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: id,
      client_name: name,
      ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
  }

  const makeContact = async (client: string, fullName: string) => {
    const contactId = randomUUID();
    await table(tenantId, 'contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      client_id: client,
      full_name: fullName,
      email: `${fullName.toLowerCase().replace(/\s+/g, '.')}@${client.slice(0, 4)}.example`,
      ...(hasColumn('contacts', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('contacts', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return contactId;
  };

  const contactA = await makeContact(clientId, 'Jane Doe');
  const contactB = await makeContact(clientId, 'Sam Patel');
  const otherClientContact = await makeContact(otherClientId, 'Nina Roy');

  await table(tenantId, 'asset_statuses')
    .insert(BUILTIN_STATUSES.map((status) => ({ tenant: tenantId, ...status, is_builtin: true, is_active: true })));

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, clientId, otherClientId, contactA, contactB, otherClientContact };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['asset_assignments', 'asset_history', 'assets', 'asset_statuses', 'contacts', 'clients', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

const baseAsset = (clientId: string) => ({
  asset_type: 'unknown',
  client_id: clientId,
  asset_tag: `TAG-${randomUUID().slice(0, 8)}`,
  name: 'Fixture laptop',
  status: 'active',
  location_id: null,
});

async function assignments(tenant: string, assetId: string) {
  return table(tenant, 'asset_assignments').where({ asset_id: assetId }).orderBy('assigned_at', 'asc');
}

describe('asset assignment history', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients', 'contacts', 'asset_assignments']) {
      columns[name] = await tenantDb(db, '__asset_assignment_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ createAsset, updateAsset, bulkUpdateAssets } = await import('@alga-psa/assets/actions/assetActions'));
    ({ assetActionErrorFrom } = await import('@alga-psa/assets/actions/assetActionErrors'));
    ({ getAssetAssignments, getContactAssignedAssets } = await import('@alga-psa/assets/actions/assetAssignmentActions'));
    ({ setAssetAssignee } = await import('@alga-psa/shared/models/assetAssignmentModel'));
    ({ clearContactLinksBeforeDelete } = await import('@alga-psa/shared/models/contactModel'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // T036: schema + backfill shape
  it('indexes open assignments per asset and per contact', async () => {
    const indexes = await db.raw(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'asset_assignments'`
    );
    const names = indexes.rows.map((row: any) => row.indexname);
    expect(names).toContain('idx_asset_assignments_asset_open');
    expect(names).toContain('idx_asset_assignments_contact_open');
  });

  // T037 / T038 / T039 / T040
  it('opens, reassigns, unassigns and no-ops through the helper', async () => {
    const fx = await seedTenant();
    const created: any = await createAsset(baseAsset(fx.clientId) as any);

    await db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, fx.contactA, {
      actorUserId: fx.userId,
      source: 'manual',
    }));

    let rows = await assignments(fx.tenantId, created.asset_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_name_id).toBe(fx.contactA);
    expect(rows[0].unassigned_at).toBeNull();
    expect(rows[0].source).toBe('manual');
    let asset = await table(fx.tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(asset.contact_name_id).toBe(fx.contactA);
    const history = await table(fx.tenantId, 'asset_history')
      .where({ asset_id: created.asset_id, change_type: 'assignee_changed' });
    expect(history).toHaveLength(1);

    // Reassign closes the first row and opens a second.
    await db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, fx.contactB, {
      actorUserId: fx.userId,
      source: 'manual',
    }));
    rows = await assignments(fx.tenantId, created.asset_id);
    expect(rows).toHaveLength(2);
    expect(rows[0].unassigned_at).not.toBeNull();
    expect(rows[0].unassigned_by_user_id).toBe(fx.userId);
    expect(rows[1].contact_name_id).toBe(fx.contactB);
    expect(rows[1].unassigned_at).toBeNull();

    // Unchanged is a no-op: no third row, no extra history.
    const noop = await db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, fx.contactB, {
      actorUserId: fx.userId,
      source: 'manual',
    }));
    expect(noop.changed).toBe(false);
    expect(await assignments(fx.tenantId, created.asset_id)).toHaveLength(2);

    // Unassign closes the open row and nulls the column.
    await db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, null, {
      actorUserId: fx.userId,
      source: 'manual',
    }));
    rows = await assignments(fx.tenantId, created.asset_id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row: any) => row.unassigned_at !== null)).toBe(true);
    asset = await table(fx.tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(asset.contact_name_id).toBeNull();
  });

  // T041
  it('rejects a contact of another client or another tenant', async () => {
    const fx = await seedTenant();
    const created: any = await createAsset(baseAsset(fx.clientId) as any);

    await expect(db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, fx.otherClientContact, {
      actorUserId: fx.userId,
      source: 'manual',
    }))).rejects.toThrow(/not available for this client/);

    const other = await seedTenant();
    actionAuth.tenant = fx.tenantId;
    await expect(db.transaction((trx) => setAssetAssignee(trx, fx.tenantId, created.asset_id, other.contactA, {
      actorUserId: fx.userId,
      source: 'manual',
    }))).rejects.toThrow(/not available for this client/);
  });

  // T042 / T043
  it('records source manual with the actor for updateAsset and bulkUpdateAssets', async () => {
    const fx = await seedTenant();
    const first: any = await createAsset(baseAsset(fx.clientId) as any);
    const second: any = await createAsset(baseAsset(fx.clientId) as any);

    const updated: any = await updateAsset(first.asset_id, { contact_name_id: fx.contactA } as any);
    expect(assetActionErrorFrom(updated)).toBeNull();
    const [row] = await assignments(fx.tenantId, first.asset_id);
    expect(row.source).toBe('manual');
    expect(row.assigned_by_user_id).toBe(fx.userId);

    const bulk: any = await bulkUpdateAssets([first.asset_id, second.asset_id], { contact_name_id: fx.contactB } as any);
    expect(bulk.succeeded).toBe(2);
    for (const assetId of [first.asset_id, second.asset_id]) {
      const open = await table(fx.tenantId, 'asset_assignments')
        .where({ asset_id: assetId })
        .whereNull('unassigned_at');
      expect(open).toHaveLength(1);
      expect(open[0].contact_name_id).toBe(fx.contactB);
    }
  });

  // FR-C3: createAsset with a contact opens the row at creation.
  it('opens an assignment when the asset is created with a contact', async () => {
    const fx = await seedTenant();
    const created: any = await createAsset({ ...baseAsset(fx.clientId), contact_name_id: fx.contactA } as any);
    const rows = await assignments(fx.tenantId, created.asset_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_name_id).toBe(fx.contactA);
  });

  // T047
  it('closes a deleted contact\'s open assignments and nulls the column', async () => {
    const fx = await seedTenant();
    const created: any = await createAsset({ ...baseAsset(fx.clientId), contact_name_id: fx.contactA } as any);

    await db.transaction((trx) => clearContactLinksBeforeDelete(trx, fx.tenantId, fx.contactA));

    const rows = await assignments(fx.tenantId, created.asset_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].unassigned_at).not.toBeNull();
    const asset = await table(fx.tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(asset.contact_name_id).toBeNull();
  });

  // T048 / T049
  it('reads history newest first and only open rows per contact', async () => {
    const fx = await seedTenant();
    const created: any = await createAsset({ ...baseAsset(fx.clientId), contact_name_id: fx.contactA } as any);
    await updateAsset(created.asset_id, { contact_name_id: fx.contactB } as any);

    const history = await getAssetAssignments(created.asset_id) as any[];
    expect(history).toHaveLength(2);
    expect(history[0].contact_name_id).toBe(fx.contactB);
    expect(history[0].contact_name).toBe('Sam Patel');
    expect(history[0].assigned_by_name).toContain('Alex');

    const held = await getContactAssignedAssets(fx.contactB) as any[];
    expect(held.map((row) => row.asset_id)).toEqual([created.asset_id]);
    expect(await getContactAssignedAssets(fx.contactA)).toHaveLength(0);

    // Another tenant's asset returns nothing under this session.
    const other = await seedTenant();
    expect(await getAssetAssignments(created.asset_id)).toHaveLength(0);
    expect(other.tenantId).not.toBe(fx.tenantId);
  });
});

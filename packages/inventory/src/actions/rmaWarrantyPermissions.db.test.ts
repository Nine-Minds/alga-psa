/**
 * C5 T020 / T021 (real DB): the warranty permission is granted to existing tenants by the migration and to new ones
 * by the catalog; refusals happen before any write; a hidden asset reads as not found; rows without an asset keep
 * today's visibility.
 *
 * Test order is shuffled (sequence.shuffle), so no test may rely on RBAC state another test leaves behind. The suite
 * tenant is provisioned in beforeAll the way a new tenant is (default roles + catalog sync); the migration test
 * builds its own pre-warranty "existing tenant".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder: { knex: Knex; tenant: string; userId: string; userType: string; grants: Set<string> | null } = {
  knex: undefined as never, tenant: '', userId: '', userType: 'internal', grants: null,
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant, user_type: holder.userType }, { tenant: holder.tenant }, ...args),
}));
// grants === null -> the real RBAC check against the seeded role tables; otherwise an explicit grant set.
vi.mock('@alga-psa/auth/rbac', async (orig) => {
  const actual = await orig<typeof import('@alga-psa/auth/rbac')>();
  return {
    ...actual,
    hasPermission: async (user: any, resource: string, action: string, ...rest: any[]) =>
      holder.grants === null ? actual.hasPermission(user, resource, action, ...rest) : holder.grants.has(`${resource}:${action}`),
  };
});
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined), reviveStoredWorkflowPayload: () => null,
}));
const denied = vi.hoisted(() => ({ assetIds: new Set<string>() }));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', async (orig) => {
  const actual = await orig<typeof import('@alga-psa/assets/lib/assetReadAuthorization')>();
  return {
    ...actual,
    isAssetReadAllowed: async (...args: Parameters<typeof actual.isAssetReadAllowed>) =>
      denied.assetIds.has(args[3].asset_id) ? false : actual.isAssetReadAllowed(...args),
    filterReadableAssets: async (...args: Parameters<typeof actual.filterReadableAssets>) =>
      (await actual.filterReadableAssets(...args)).filter((a) => !denied.assetIds.has(a.asset_id)),
  };
});

import { approveWarrantyClaim, denyWarrantyClaim, openWarrantyClaim } from './rmaWarrantyActions';
import { getRmaCase, listRmaCases } from './rmaActions';
import { openCustody } from '@alga-psa/assets/lib/custody/openCustody';
import { loadPermissionUtils, loadServerMigration } from '../test-utils/serverMigrations';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const { DEFAULT_ROLES, syncPermissionCatalog } = loadPermissionUtils();
const warrantyMigration = loadServerMigration<any>('20261029130400_add_warranty_permissions.cjs');

let knex: Knex;
let LOCATION: string;
let VENDOR: string;
let CLIENT: string;
let TICKET: string;
let TECH_USER: string;
let INV_READ_USER: string;
let NO_ROLE_USER: string;
let OPERATOR: string;

const ok = (r: any): any => {
  expect(r?.actionError ?? r?.permissionError, JSON.stringify(r)).toBeUndefined();
  return r;
};

const grantsOf = async (tenant: string, roleName: string) => {
  const rows = await knex('role_permissions as rp')
    .join('roles as r', (j) => j.on('r.tenant', 'rp.tenant').andOn('r.role_id', 'rp.role_id'))
    .join('permissions as p', (j) => j.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'))
    .where('rp.tenant', tenant).where('r.role_name', roleName).where('r.msp', true).where('p.resource', 'warranty')
    .select('p.action');
  return rows.map((r: any) => r.action).sort();
};

async function insertRoles(tenant: string, { includeLegacy }: { includeLegacy: boolean }) {
  await knex('roles').insert(DEFAULT_ROLES.psa.filter((r: any) => includeLegacy || !r.legacy).map((r: any) => ({
    tenant, role_name: r.roleName, description: r.roleName, msp: r.msp, client: r.client,
  })));
}

async function addUser(roleId: string | null): Promise<string> {
  const userId = randomUUID();
  await knex('users').insert({
    tenant: holder.tenant, user_id: userId, username: `u-${userId}`, email: `${userId}@example.invalid`,
    hashed_password: 'x', user_type: 'internal', first_name: 'P', last_name: 'T',
  });
  if (roleId) await knex('user_roles').insert({ tenant: holder.tenant, user_id: userId, role_id: roleId });
  return userId;
}

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  holder.knex = knex;
  holder.tenant = await createInventoryTestTenant(knex);
  OPERATOR = (await knex('users').where({ tenant: holder.tenant }).first()).user_id;
  holder.userId = OPERATOR;
  LOCATION = (await knex('stock_locations').where({ tenant: holder.tenant }).first()).location_id;
  VENDOR = (await knex('vendors').where({ tenant: holder.tenant }).first()).vendor_id;
  CLIENT = (await knex('clients').where({ tenant: holder.tenant }).first()).client_id;
  TICKET = (await knex('tickets').where({ tenant: holder.tenant }).first()).ticket_id;
  await knex('asset_statuses').insert([
    { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
    { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
    { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
  ].map((s) => ({ tenant: holder.tenant, ...s, is_builtin: true, is_active: true })));

  // The suite tenant is provisioned like a new tenant, so real-RBAC checks see the current catalog's grants.
  await insertRoles(holder.tenant, { includeLegacy: false });
  const provisioned = await syncPermissionCatalog(knex, holder.tenant, 'psa', { onDrift: 'throw' });
  expect(provisioned.skipped).toBeFalsy();
});
beforeEach(() => { holder.grants = null; holder.userType = 'internal'; holder.userId = OPERATOR; denied.assetIds.clear(); });
afterAll(async () => { await knex?.destroy(); });

const roleId = async (name: string) =>
  (await knex('roles').where({ tenant: holder.tenant, role_name: name, msp: true }).first()).role_id as string;
const caseCount = async () => Number((await knex('rma_cases').where({ tenant: holder.tenant }).count('* as c').first())!.c);
const eventCount = async () => Number((await knex('rma_events').where({ tenant: holder.tenant }).count('* as c').first())!.c);

async function newAsset() {
  const assetId = randomUUID();
  await knex('assets').insert({
    tenant: holder.tenant, asset_id: assetId, asset_type: 'unknown', client_id: CLIENT, asset_tag: `P-${assetId.slice(0, 8)}`,
    name: 'Dell WD19 dock', serial_number: 'SER-1234', model: 'WD19', manufacturer: 'Dell', status: 'active', location: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return assetId;
}
const inCustody = (assetId: string) =>
  knex.transaction((trx) => openCustody(trx, holder.tenant, holder.userId, {
    asset_id: assetId, ticket_id: TICKET, purpose: 'repair', location_id: LOCATION, bin: 'B3',
    next_action_party: 'msp', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [],
  } as any));

describe('T020 warranty permission provisioning and enforcement', () => {
  it('the migration grants warranty read/create/update to existing tenants Admin, Manager and Technician; the catalog does the same for a new tenant', async () => {
    // An "existing tenant": default roles only, created before the warranty catalog entries (no permission rows).
    const existing = await createInventoryTestTenant(knex);
    await insertRoles(existing, { includeLegacy: true });
    expect(await knex('permissions').where({ tenant: existing, resource: 'warranty' }).count('* as c').first()).toMatchObject({ c: '0' });

    const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { lines.push(String(m)); });
    const warn = vi.spyOn(console, 'warn').mockImplementation((m) => { lines.push(String(m)); });
    try { await warrantyMigration.up(knex); } finally { log.mockRestore(); warn.mockRestore(); }


    const perms = await knex('permissions').where({ tenant: existing, resource: 'warranty' }).select('action', 'msp', 'client');
    expect(perms.map((p: any) => p.action).sort()).toEqual(['create', 'read', 'update']);
    expect(perms.every((p: any) => p.msp === true && p.client === false)).toBe(true);
    for (const role of ['Admin', 'Manager', 'Technician']) expect(await grantsOf(existing, role)).toEqual(['create', 'read', 'update']);
    expect(await grantsOf(existing, 'Dispatcher')).toEqual([]);

    // Re-running is additive and writes nothing more.
    const before = Number((await knex('role_permissions').where({ tenant: existing }).count('* as c').first())!.c);
    const l2 = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try { await warrantyMigration.up(knex); } finally { l2.mockRestore(); }
    expect(Number((await knex('role_permissions').where({ tenant: existing }).count('* as c').first())!.c)).toBe(before);

    // New tenant: the catalog sync alone provisions it.
    const fresh = await createInventoryTestTenant(knex);
    await insertRoles(fresh, { includeLegacy: false });
    const res = await syncPermissionCatalog(knex, fresh, 'psa', { onDrift: 'throw' });
    expect(res.skipped).toBeFalsy();
    const freshGrants = await knex('role_permissions as rp')
      .join('roles as r', (j) => j.on('r.tenant', 'rp.tenant').andOn('r.role_id', 'rp.role_id'))
      .join('permissions as p', (j) => j.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'))
      .where('rp.tenant', fresh).where('p.resource', 'warranty').where('r.role_name', 'Technician').select('p.action');
    expect(freshGrants.map((g: any) => g.action).sort()).toEqual(['create', 'read', 'update']);
  });

  it('a technician (real RBAC) can open and transition claims; warranty:update missing refuses before any write; inventory:read alone still lists', async () => {
    TECH_USER = await addUser(await roleId('Technician'));
    // inventory:read-only custom role
    const customRole = randomUUID();
    await knex('roles').insert({ tenant: holder.tenant, role_id: customRole, role_name: 'Inventory viewer', description: 'x', msp: true, client: false });
    const invRead = await knex('permissions').where({ tenant: holder.tenant, resource: 'inventory', action: 'read', msp: true }).first();
    expect(invRead).toBeTruthy();
    await knex('role_permissions').insert({ tenant: holder.tenant, role_id: customRole, permission_id: invRead.permission_id });
    INV_READ_USER = await addUser(customRole);
    NO_ROLE_USER = await addUser(null);

    const assetId = await newAsset();
    await inCustody(assetId);

    holder.userId = TECH_USER;
    holder.grants = null;
    const opened = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'Dock drops displays' }));
    const approved = ok(await approveWarrantyClaim(opened.rma_id, { track: 'standard', vendor_id: VENDOR }));
    expect(approved.status).toBe('awaiting_return');

    // A second open claim to refuse against.
    const a2 = await newAsset();
    await inCustody(a2);
    const second = ok(await openWarrantyClaim({ asset_id: a2, reason: 'x' }));

    const snapshot = async () => ({ cases: await caseCount(), events: await eventCount(), row: await knex('rma_cases').where({ tenant: holder.tenant, rma_id: second.rma_id }).first(), history: await knex('asset_history').where({ tenant: holder.tenant, asset_id: a2 }).count('* as c').first() });
    const before = await snapshot();

    // warranty:read + asset:update but no update (and no inventory:update): refused before writing.
    holder.grants = new Set(['warranty:read', 'warranty:create', 'asset:update']);
    expect(await denyWarrantyClaim(second.rma_id, { denial_reason: 'n' })).toHaveProperty('permissionError');
    expect(await approveWarrantyClaim(second.rma_id, { track: 'standard', vendor_id: VENDOR })).toHaveProperty('permissionError');
    // real RBAC: a user with no roles is refused too.
    holder.grants = null;
    holder.userId = NO_ROLE_USER;
    expect(await denyWarrantyClaim(second.rma_id, { denial_reason: 'n' })).toHaveProperty('permissionError');
    expect(await openWarrantyClaim({ asset_id: a2, reason: 'again' })).toHaveProperty('permissionError');
    // real RBAC: inventory:read only - no update.
    holder.userId = INV_READ_USER;
    expect(await denyWarrantyClaim(second.rma_id, { denial_reason: 'n' })).toHaveProperty('permissionError');
    expect(await snapshot()).toEqual(before);

    // ...but that role still lists (and reads) RMAs.
    const listed = ok(await listRmaCases()) as any[];
    expect(listed.map((r) => r.rma_id)).toEqual(expect.arrayContaining([opened.rma_id, second.rma_id]));
    expect(await getRmaCase(second.rma_id)).toMatchObject({ rma_id: second.rma_id });

    // technician can still transition.
    holder.userId = TECH_USER;
    expect(ok(await denyWarrantyClaim(second.rma_id, { denial_reason: 'n' })).status).toBe('closed');
  });
});

describe('T021 record-level asset visibility on RMA reads', () => {
  it('a case whose asset the caller cannot read is hidden exactly like a missing case; asset-less rows keep today\'s visibility', async () => {
    holder.grants = new Set(['warranty:read', 'warranty:create', 'inventory:read', 'asset:update']);

    const assetId = await newAsset();
    await inCustody(assetId);
    const claim = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', ticket_id: TICKET }));

    // a stock-unit RMA row: no asset_id
    const service = await knex('service_catalog').where({ tenant: holder.tenant }).first();
    const unitId = randomUUID();
    await knex('stock_units').insert({ tenant: holder.tenant, unit_id: unitId, service_id: service.service_id, serial_number: 'UNIT-1' });
    const unitRma = randomUUID();
    await knex('rma_cases').insert({ tenant: holder.tenant, rma_id: unitRma, rma_number: `RMA-T021-${unitRma.slice(0, 6)}`, returned_unit_id: unitId, client_id: CLIENT });

    const missing = randomUUID();
    expect(await getRmaCase(claim.rma_id)).toMatchObject({ rma_id: claim.rma_id });
    expect(await getRmaCase(unitRma)).toMatchObject({ rma_id: unitRma });
    const missingResult = await getRmaCase(missing);

    denied.assetIds.add(assetId);
    const hidden = await getRmaCase(claim.rma_id);
    expect(hidden).toBeNull();
    expect(hidden).toEqual(missingResult);
    const all = (await listRmaCases()) as any[];
    expect(all.map((r) => r.rma_id)).not.toContain(claim.rma_id);
    expect((await listRmaCases({ asset_id: assetId })) as any[]).toHaveLength(0);
    // asset-less row unchanged by the asset denial
    expect(all.map((r) => r.rma_id)).toContain(unitRma);
    expect(await getRmaCase(unitRma)).toMatchObject({ rma_id: unitRma, asset_id: null });

    denied.assetIds.clear();
    expect(await getRmaCase(claim.rma_id)).toMatchObject({ rma_id: claim.rma_id });
    expect(((await listRmaCases()) as any[]).map((r) => r.rma_id)).toEqual(expect.arrayContaining([claim.rma_id, unitRma]));
  });
});

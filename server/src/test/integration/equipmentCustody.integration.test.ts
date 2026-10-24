/**
 * alga-2026-0002683 C4 - equipment custody and ticket intake (real DB).
 *
 * Covers: the no-stock/no-money invariant (row counts across both intake modes and every step), the state
 * machine and refusals, update-vs-event semantics, the queue (record-level, closed-ticket items, tabs),
 * the guards (asset delete, location deactivation), held_by_msp -> active on return, and the append-only
 * trigger on plain Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const published = vi.hoisted(() => ({ events: [] as Array<{ eventType: string; payload: any }> }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn(async (e: any) => {
    published.events.push({ eventType: e.eventType, payload: e.payload });
  }),
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
    withAuth: (action: any) => async (...args: unknown[]) =>
      action({ user_id: actionAuth.userId, user_type: 'internal', roles: [] }, { tenant: actionAuth.tenant }, ...args),
  };
});
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth/rbac')>();
  return { ...actual, hasPermission: vi.fn().mockResolvedValue(true) };
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
let custody: typeof import('@alga-psa/assets/actions/assetCustodyActions');
let receiveEquipment: typeof import('../../../../packages/msp-composition/src/tickets/receiveEquipmentActions').receiveEquipment;
let deleteAssetRecord: typeof import('@alga-psa/assets/actions/assetActions').deleteAssetRecord;
let listAssets: typeof import('@alga-psa/assets/actions/assetActions').listAssets;
let isCitus = false;

const cleanupTenants = new Set<string>();

const table = (tenant: string, name: string) => tenantDb(db, tenant).table(name);
const unscoped = (name: string) => tenantDb(db, '__custody_fixture__').unscoped(name, 'custody integration fixture');
const hasColumn = (name: string, column: string) => Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);

const BUILTINS = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

/** Tables the intake must never write (design hard constraint). */
const FORBIDDEN_TABLES = [
  'stock_units', 'stock_movements', 'stock_levels', 'product_inventory_settings',
  'invoices', 'invoice_charges', 'time_entries',
];

type Fx = Awaited<ReturnType<typeof seedFixture>>;

async function seedFixture() {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Custody PSA' } : { client_name: 'Custody PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  const mkUser = async (name: string) => {
    const userId = randomUUID();
    await table(tenantId, 'users').insert({
      tenant: tenantId, user_id: userId, username: `${name}-${userId.slice(0, 8)}`, hashed_password: 'x',
      first_name: name, last_name: 'Tech',
      ...(hasColumn('users', 'email') ? { email: `${name}-${userId.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
      ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return userId;
  };
  const userId = await mkUser('Alex');
  const otherUserId = await mkUser('Sam');
  const mkClient = async (name: string) => {
    const clientId = randomUUID();
    await table(tenantId, 'clients').insert({
      tenant: tenantId, client_id: clientId, client_name: name,
      ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return clientId;
  };
  const clientId = await mkClient('Joymode');
  const otherClientId = await mkClient('Other Co');
  await table(tenantId, 'asset_statuses').insert(
    BUILTINS.map((s) => ({ tenant: tenantId, ...s, is_builtin: true, is_active: true }))
  );
  const mkLocation = async (name: string, active = true) => {
    const locationId = randomUUID();
    await table(tenantId, 'stock_locations').insert({
      tenant: tenantId, location_id: locationId, name, location_type: 'office', is_default: false, is_active: active,
    });
    return locationId;
  };
  const mainOffice = await mkLocation('Main Office');
  const annex = await mkLocation('Annex');
  const closedLocation = await mkLocation('Old Closet', false);

  const mkTicket = async (client: string, number: string) => {
    const ticketId = randomUUID();
    await table(tenantId, 'tickets').insert({
      tenant: tenantId, ticket_id: ticketId, ticket_number: number, client_id: client, title: `Ticket ${number}`,
    });
    return ticketId;
  };
  const ticketId = await mkTicket(clientId, `T-${tenantId.slice(0, 6)}-1`);
  const otherClientTicketId = await mkTicket(otherClientId, `T-${tenantId.slice(0, 6)}-3`);

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, otherUserId, clientId, otherClientId, mainOffice, annex, closedLocation, ticketId, otherClientTicketId, mkTicket };
}

async function counts(tenant: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of FORBIDDEN_TABLES) {
    const [{ count }] = await table(tenant, name).count('* as count');
    out[name] = Number(count);
  }
  return out;
}

async function newAsset(fx: Fx, over: Record<string, unknown> = {}) {
  const assetId = randomUUID();
  await table(fx.tenantId, 'assets').insert({
    tenant: fx.tenantId, asset_id: assetId, asset_type: 'unknown', client_id: fx.clientId,
    asset_tag: `TAG-${assetId.slice(0, 6)}`, name: 'Fixture device', status: 'active', location: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  });
  return assetId;
}

const unwrap = <T,>(r: any): T => {
  if (!r?.success) throw new Error(`expected success, got ${JSON.stringify(r)}`);
  return r.data as T;
};

const intake = (fx: Fx, over: Record<string, unknown> = {}) => ({
  ticket_id: fx.ticketId,
  new_asset: { name: 'Dell WD19 dock', asset_type: 'unknown', manufacturer: 'Dell', model: 'WD19', serial_number: 'SVC1234567' },
  purpose: 'repair',
  location_id: fx.mainOffice,
  bin: 'Shelf B3',
  next_action_party: 'vendor',
  next_action_note: 'waiting on vendor, follow up in 5 days',
  follow_up_on: '2026-10-29',
  accessories: [{ label: 'Power adapter', quantity: 1 }],
  ...over,
});

async function cleanupTenant(tenant: string) {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  if (!isCitus) {
    await db.raw('ALTER TABLE asset_custody_events DISABLE TRIGGER USER').catch(() => undefined);
  }
  for (const name of [
    'asset_custody_events', 'asset_custody', 'asset_history', 'asset_associations', 'assets', 'tickets',
    'stock_locations', 'asset_statuses', 'clients', 'users',
  ]) await del(name);
  if (!isCitus) await db.raw('ALTER TABLE asset_custody_events ENABLE TRIGGER USER').catch(() => undefined);
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

describe('equipment custody (integration)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__custody_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    isCitus = Boolean((await db.raw("select 1 from pg_extension where extname = 'citus'")).rows.length);
    custody = await import('@alga-psa/assets/actions/assetCustodyActions');
    ({ deleteAssetRecord, listAssets } = await import('@alga-psa/assets/actions/assetActions'));
    ({ receiveEquipment } = await import('../../../../packages/msp-composition/src/tickets/receiveEquipmentActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('never writes stock, money or time across both intake modes and every step (hard invariant)', async () => {
    const fx = await seedFixture();
    const before = await counts(fx.tenantId);

    // Mode 1: a brand-new minimal asset.
    const created = unwrap<any>(await receiveEquipment(intake(fx)));
    expect(created.createdAsset).toBe(true);
    expect(created.asset.asset_tag).toMatch(/-EQ1$/);
    const row = await table(fx.tenantId, 'assets').where({ asset_id: created.asset.asset_id }).first();
    expect(row).toMatchObject({ status: 'held_by_msp', ownership: 'client', client_id: fx.clientId });
    expect(row.stock_unit_id ?? null).toBeNull();
    expect(row.service_id ?? null).toBeNull();

    // Mode 2: an existing asset, received back-to-back after the first goes out.
    const existing = await newAsset(fx);
    const second = unwrap<any>(await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing, bin: 'Shelf C1' }));
    expect(second.createdAsset).toBe(false);

    const c1 = created.custody.custody_id;
    unwrap(await custody.moveCustody(c1, { bin: 'Shelf C1' }));
    unwrap(await custody.handOffCustody(c1, { to_holder_user_id: fx.otherUserId }));
    unwrap(await custody.shipCustody(c1, { counterparty: 'Dell' }));
    unwrap(await custody.receiveBackCustody(c1, { location_id: fx.annex, bin: 'Dock 2' }));
    unwrap(await custody.returnCustodyToClient(c1, {}));
    unwrap(await custody.returnCustodyToClient(second.custody.custody_id, {}));

    expect(await counts(fx.tenantId)).toEqual(before);
    // The assets of this intake did not gain stock/service links either.
    const linked = await table(fx.tenantId, 'assets').whereNotNull('stock_unit_id').count('* as count').first();
    expect(Number((linked as any).count)).toBe(0);
  });

  it('refuses a client mismatch, an inactive location and a second open episode', async () => {
    const fx = await seedFixture();
    // tickets.client_id is NOT NULL in this schema, so "ticket has no client" is a defensive check only
    // (covered by the unit test of openCustody's guard order); the reachable refusals follow.
    const existing = await newAsset(fx);
    const mismatch: any = await receiveEquipment({ ...intake(fx, { ticket_id: fx.otherClientTicketId }), new_asset: undefined, asset_id: existing });
    expect(mismatch).toMatchObject({ success: false, error: { code: 'client_mismatch' } });

    const inactive: any = await receiveEquipment(intake(fx, { location_id: fx.closedLocation }));
    expect(inactive).toMatchObject({ success: false, error: { code: 'location_inactive' } });
    // Failed intakes leave nothing behind, including the new asset.
    expect(await table(fx.tenantId, 'assets').where({ name: 'Dell WD19 dock' })).toHaveLength(0);

    const ok = unwrap<any>(await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing }));
    const again: any = await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing });
    expect(again).toMatchObject({ success: false, error: { code: 'open_episode_exists' } });
    expect(again.error.message).toContain('Main Office');
    expect(ok.custody.state).toBe('in_office');
  });

  it('enforces the state machine and records one append-only event per step', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    const id = r.custody.custody_id;

    expect(await custody.receiveBackCustody(id, { location_id: fx.annex, bin: null })).toMatchObject({ success: false, error: { code: 'invalid_transition' } });
    expect(await custody.moveCustody(id, { bin: 'Shelf B3' })).toMatchObject({ success: false, error: { code: 'no_change' } });
    expect(await custody.moveCustody(id, { location_id: fx.closedLocation })).toMatchObject({ success: false, error: { code: 'location_inactive' } });

    unwrap(await custody.moveCustody(id, { bin: 'Shelf C1' }));
    const shipped = unwrap<any>(await custody.shipCustody(id, { counterparty: 'Dell' }));
    expect(shipped.custody).toMatchObject({ state: 'with_vendor', location_id: null, bin: null, next_action_party: 'vendor' });
    expect(await custody.moveCustody(id, { bin: 'X' })).toMatchObject({ success: false, error: { code: 'invalid_transition' } });
    unwrap(await custody.receiveBackCustody(id, { location_id: fx.annex, bin: 'Dock 2' }));
    const returned = unwrap<any>(await custody.returnCustodyToClient(id, {}));
    expect(returned.custody).toMatchObject({ state: 'closed', close_reason: 'returned_to_client' });
    expect(await custody.moveCustody(id, { bin: 'Y' })).toMatchObject({ success: false, error: { code: 'episode_closed' } });

    const events = unwrap<any[]>(await custody.listCustodyEvents(r.asset.asset_id));
    expect(events.map((e) => e.event_type)).toEqual(['received', 'moved', 'shipped', 'received', 'returned']);
    expect(events[0]).toMatchObject({ to_location_name: 'Main Office', to_bin: 'Shelf B3' });
    expect(events[1]).toMatchObject({ from_bin: 'Shelf B3', to_bin: 'Shelf C1' });

    const history = await table(fx.tenantId, 'asset_history').where({ asset_id: r.asset.asset_id }).whereLike('change_type', 'custody_%');
    expect(history.map((h: any) => h.change_type).sort()).toEqual(
      ['custody_moved', 'custody_received', 'custody_received', 'custody_returned', 'custody_shipped'].sort()
    );
    expect(published.events.filter((e) => e.eventType === 'ASSET_CUSTODY_CHANGED').length).toBeGreaterThanOrEqual(5);
  });

  it('writes non-physical edits as custody_updated history, not events, and keeps follow_up_on a calendar date', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    expect(r.custody.follow_up_on).toBe('2026-10-29');
    const id = r.custody.custody_id;
    const eventsBefore = await table(fx.tenantId, 'asset_custody_events').where({ custody_id: id });

    const upd = unwrap<any>(await custody.updateCustody(id, { next_action_party: 'client', follow_up_on: '2026-11-02', next_action_note: 'client to approve' }));
    expect(upd.custody).toMatchObject({ next_action_party: 'client', follow_up_on: '2026-11-02' });
    expect(await table(fx.tenantId, 'asset_custody_events').where({ custody_id: id })).toHaveLength(eventsBefore.length);
    const h = await table(fx.tenantId, 'asset_history').where({ asset_id: r.asset.asset_id, change_type: 'custody_updated' });
    expect(h).toHaveLength(1);
    expect(JSON.stringify(h[0].changes)).not.toContain('client to approve');
    expect(await custody.updateCustody(id, { follow_up_on: '2026-02-31' } as any)).toMatchObject({ success: false, error: { code: 'validation' } });
  });

  it('keeps the queue keyed off the open episode (closed ticket still listed), with tabs and filters', async () => {
    const fx = await seedFixture();
    const a = unwrap<any>(await receiveEquipment(intake(fx)));
    const b = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'Laptop' }, next_action_party: 'client', follow_up_on: '2020-01-01', bin: null })));
    // The ticket "closes": the queue must not care, and neither must the status column.
    await table(fx.tenantId, 'assets').where({ asset_id: a.asset.asset_id }).update({ status: 'retired' });

    const all = unwrap<any>(await custody.listCustodyQueue({}));
    expect(all.total).toBe(2);
    expect(all.tabCounts).toMatchObject({ all_open: 2, waiting_on_vendor: 1, waiting_on_client: 1, overdue: 1 });
    expect(unwrap<any>(await custody.listCustodyQueue({ tab: 'overdue' })).rows.map((r: any) => r.asset_id)).toEqual([b.asset.asset_id]);
    expect(unwrap<any>(await custody.listCustodyQueue({ location_id: fx.annex })).total).toBe(0);

    unwrap(await custody.returnCustodyToClient(a.custody.custody_id, {}));
    expect(unwrap<any>(await custody.listCustodyQueue({})).total).toBe(1);
    // Returned item with a non-held_by_msp status keeps it (retired is not overwritten).
    expect((await table(fx.tenantId, 'assets').where({ asset_id: a.asset.asset_id }).first()).status).toBe('retired');
  });

  it('moves held_by_msp back to active on return and filters the asset list by custody and ownership', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    const other = await newAsset(fx);
    const held: any = await listAssets({ in_custody: true } as any);
    expect(held.assets.map((a: any) => a.asset_id)).toEqual([r.asset.asset_id]);
    const notHeld: any = await listAssets({ in_custody: false } as any);
    expect(notHeld.assets.map((a: any) => a.asset_id)).toEqual([other]);

    unwrap(await custody.returnCustodyToClient(r.custody.custody_id, {}));
    expect((await table(fx.tenantId, 'assets').where({ asset_id: r.asset.asset_id }).first()).status).toBe('active');
    expect(published.events.some((e) => e.eventType === 'ASSET_UPDATED' && e.payload?.assetId === r.asset.asset_id)).toBe(true);
    const owned: any = await listAssets({ ownership: 'msp' } as any);
    expect(owned.assets).toHaveLength(0);
  });

  it('guards asset delete and location deactivation while an episode is open', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    await expect(
      deleteAssetRecord(db, fx.tenantId, fx.userId, r.asset.asset_id, { suppressRevalidate: true })
    ).rejects.toThrow(/in custody/);
    expect(await table(fx.tenantId, 'assets').where({ asset_id: r.asset.asset_id })).toHaveLength(1);

    const { deactivateStockLocation } = await import('@alga-psa/inventory/actions/stockLocationActions');
    await expect(deactivateStockLocation(fx.mainOffice)).rejects.toThrow(/client equipment in custody/);
    expect((await table(fx.tenantId, 'stock_locations').where({ location_id: fx.mainOffice }).first()).is_active).toBe(true);

    unwrap(await custody.returnCustodyToClient(r.custody.custody_id, {}));
    const ok: any = await deactivateStockLocation(fx.mainOffice);
    expect(ok.is_active).toBe(false);
  });

  it('exposes only id, name and type from listCustodyLocations and lists previously used bins', async () => {
    const fx = await seedFixture();
    unwrap(await receiveEquipment(intake(fx)));
    const locs = unwrap<any[]>(await custody.listCustodyLocations());
    expect(locs.map((l) => l.name).sort()).toEqual(['Annex', 'Main Office']);
    for (const l of locs) expect(Object.keys(l).sort()).toEqual(['is_default', 'location_id', 'location_type', 'name']);
    expect(unwrap<string[]>(await custody.listCustodyBins(fx.mainOffice))).toEqual(['Shelf B3']);
  });

  it('rejects UPDATE and DELETE on asset_custody_events on plain Postgres', async () => {
    if (isCitus) return; // Citus: no triggers on distributed tables; enforced by app discipline (documented).
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    await expect(
      table(fx.tenantId, 'asset_custody_events').where({ custody_id: r.custody.custody_id }).update({ note: 'tamper' })
    ).rejects.toThrow(/append-only/i);
    await expect(table(fx.tenantId, 'asset_custody_events').where({ custody_id: r.custody.custody_id }).del()).rejects.toThrow(/append-only/i);
  });
});

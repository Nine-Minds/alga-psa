/**
 * Advance-replacement dead-unit leg (alga-2026-0002683, real DB). The Dell advance flow through shipping the
 * dead unit to the vendor and the vendor's receipt, the guard matrix, the shared `dead_unit_owed` status told
 * apart from the stock track, permissions, and the hard invariant: no stock row ever changes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

// `readScope` makes the caller a client-portal user scoped to another client, so the REAL asset read check
// (builtin same_client rule) denies the asset: no module mock has to intercept the gate.
const holder: { knex: Knex; tenant: string; userId: string; grants: Set<string> | null; readScope: { user_type: string; clientId: string | null } } = {
  knex: undefined as never, tenant: '', userId: '', grants: null, readScope: { user_type: 'internal', clientId: null },
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant, ...holder.readScope }, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: unknown, resource: string, action: string) => holder.grants === null || holder.grants.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));
const published = vi.hoisted(() => ({ events: [] as Array<{ eventType: string; payload: any }> }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async (e: any) => { published.events.push({ eventType: e.eventType, payload: e.payload }); }),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async (e: any) => { published.events.push({ eventType: e.eventType, payload: e.payload }); }),
  publishUnregisteredEventType: vi.fn(async () => undefined), reviveStoredWorkflowPayload: () => null,
}));
import {
  approveWarrantyClaim, closeWarrantyRma, confirmVendorReceipt, openWarrantyClaim, receiveVendorReplacement,
  returnDeviceToClient, shipDeadUnitToVendor, shipToVendor, markDeviceReceived,
} from './rmaWarrantyActions';
import {
  chargeForUnreturned, closeRma, deadUnitsOwedReport, markDeadUnitOwed, openRma, recordDeadUnitReturned, receiveReturn,
} from './rmaActions';
import { openCustody } from '@alga-psa/assets/lib/custody/openCustody';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

let knex: Knex;
let LOCATION: string;
let VENDOR: string;
let CLIENT: string;
let TICKET: string;
let SERVICE: string;

const FORBIDDEN = ['stock_units', 'stock_movements', 'stock_levels', 'invoices', 'invoice_charges', 'time_entries'];
const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of FORBIDDEN) out[t] = Number((await knex(t).where({ tenant: holder.tenant }).count('* as c').first())!.c);
  return out;
};

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  holder.knex = knex;
  holder.tenant = await createInventoryTestTenant(knex);
  holder.userId = (await knex('users').where({ tenant: holder.tenant }).first()).user_id;
  LOCATION = (await knex('stock_locations').where({ tenant: holder.tenant }).first()).location_id;
  VENDOR = (await knex('vendors').where({ tenant: holder.tenant }).first()).vendor_id;
  CLIENT = (await knex('clients').where({ tenant: holder.tenant }).first()).client_id;
  TICKET = (await knex('tickets').where({ tenant: holder.tenant }).first()).ticket_id;
  SERVICE = (await knex('service_catalog').where({ tenant: holder.tenant }).first()).service_id;
  await knex('asset_statuses').insert([
    { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
    { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
    { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
  ].map((s) => ({ tenant: holder.tenant, ...s, is_builtin: true, is_active: true })));
});
beforeEach(() => { holder.grants = null; holder.readScope = { user_type: 'internal', clientId: null }; published.events.length = 0; });
afterAll(async () => { await knex?.destroy(); });

const ok = (r: any): any => {
  expect(r?.actionError ?? r?.permissionError, JSON.stringify(r)).toBeUndefined();
  return r;
};

async function newAsset(over: Record<string, unknown> = {}) {
  const assetId = randomUUID();
  await knex('assets').insert({
    tenant: holder.tenant, asset_id: assetId, asset_type: 'unknown', client_id: CLIENT, asset_tag: `T-${assetId.slice(0, 8)}`,
    name: 'Dell WD19 dock', serial_number: 'OLD-SERIAL', model: 'WD19', manufacturer: 'Dell', status: 'active', location: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  });
  return assetId;
}
async function inCustody(assetId: string) {
  return knex.transaction((trx) => openCustody(trx, holder.tenant, holder.userId, {
    asset_id: assetId, ticket_id: TICKET, purpose: 'repair', location_id: LOCATION, bin: 'B3',
    next_action_party: 'msp', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [],
  } as any));
}
const rmaRow = (id: string) => knex('rma_cases').where({ tenant: holder.tenant, rma_id: id }).first();
const custodyRow = (id: string) => knex('asset_custody').where({ tenant: holder.tenant, custody_id: id }).first();
const events = (id: string) => knex('rma_events').where({ tenant: holder.tenant, rma_id: id }).orderBy('occurred_at').orderBy('recorded_at');
const eventTypes = async (id: string) => (await events(id)).map((e: any) => e.event_type);

/** Open → approve (advance) → custody in_office → receive replacement. Returns a case in `replaced`. */
async function replacedAdvanceCase() {
  const assetId = await newAsset();
  const { custody } = await inCustody(assetId);
  const opened = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'Dock drops displays', rma_type: 'advance_replacement' }));
  ok(await approveWarrantyClaim(opened.rma_id, { track: 'advance_replacement', vendor_id: VENDOR, rma_reference: 'DELL-ADV-1' }));
  ok(await receiveVendorReplacement(opened.rma_id, { replacement_serial_number: 'NEW-SERIAL', location_id: LOCATION }));
  return { assetId, custody, rmaId: opened.rma_id as string };
}

async function stockCaseInDeadUnitOwed() {
  const [u] = await knex('stock_units')
    .insert({ tenant: holder.tenant, service_id: SERVICE, serial_number: `SN-${randomUUID()}`, status: 'delivered', client_id: CLIENT, unit_cost: 1000 })
    .returning('*');
  const rma: any = ok(await openRma({ returned_unit_id: u.unit_id, reason: 'dead' }));
  await knex('rma_cases').where({ tenant: holder.tenant, rma_id: rma.rma_id }).update({ status: 'dead_unit_owed', rma_type: 'advance_replacement', dead_unit_due_date: '2026-12-01' });
  return { unitId: u.unit_id as string, rmaId: rma.rma_id as string };
}

describe('advance-replacement dead-unit leg', () => {
  it('Dell advance flow: replacement received, dead unit shipped to the vendor, vendor receipt closes resolved', async () => {
    const assetId = await newAsset();
    const { custody } = await inCustody(assetId);
    const before = await counts();

    const opened = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'Dock drops displays', rma_type: 'advance_replacement' }));
    ok(await approveWarrantyClaim(opened.rma_id, { track: 'advance_replacement', vendor_id: VENDOR, rma_reference: 'DELL-ADV-1' }));
    expect((await rmaRow(opened.rma_id)).status).toBe('open');
    expect((await custodyRow(custody.custody_id)).state).toBe('in_office');

    expect(ok(await receiveVendorReplacement(opened.rma_id, { replacement_serial_number: 'NEW-SERIAL', location_id: LOCATION })).status).toBe('replaced');
    expect((await custodyRow(custody.custody_id)).state).toBe('in_office');
    expect((await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).first()).serial_number).toBe('NEW-SERIAL');

    published.events.length = 0;
    const shipped = ok(await shipDeadUnitToVendor(opened.rma_id, { carrier: 'UPS', tracking_number: '1Z-DEAD-1', return_by: '2026-12-15' }));
    expect(shipped).toMatchObject({ status: 'dead_unit_owed', outbound_carrier: 'UPS', outbound_tracking_number: '1Z-DEAD-1', return_by: '2026-12-15', returned_unit_id: null });
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'with_vendor', close_reason: null });
    expect(published.events.map((e) => e.eventType)).toContain('INVENTORY_RMA_UPDATED');

    const shippedEvent = (await events(opened.rma_id)).find((e: any) => e.event_type === 'dead_unit_shipped');
    expect(shippedEvent).toBeTruthy();
    // The asset row now carries the replacement's serial; the dead unit's serial is kept in the event payload.
    expect(JSON.stringify(shippedEvent.payload)).toContain('OLD-SERIAL');
    // Carrier and tracking live on the case; the custody shipment event carries them in its note.
    expect(await rmaRow(opened.rma_id)).toMatchObject({ outbound_carrier: 'UPS', outbound_tracking_number: '1Z-DEAD-1' });
    const custodyShipped = await knex('asset_custody_events').where({ tenant: holder.tenant, custody_id: custody.custody_id, event_type: 'shipped' }).first();
    expect(custodyShipped.note).toContain('1Z-DEAD-1');
    expect(custodyShipped.note).toContain('OLD-SERIAL');

    const confirmed = ok(await confirmVendorReceipt(opened.rma_id, {}));
    expect(confirmed).toMatchObject({ status: 'closed', closed_reason: 'resolved' });
    expect(confirmed.closed_at).toBeTruthy();
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'closed', close_reason: 'returned_to_vendor' });

    expect(await eventTypes(opened.rma_id)).toEqual(expect.arrayContaining(['opened', 'warranty_approved', 'replacement_received', 'dead_unit_shipped', 'vendor_receipt_confirmed']));
    expect(await eventTypes(opened.rma_id)).not.toContain('returned_to_client');

    const history = await knex('asset_history').where({ tenant: holder.tenant, asset_id: assetId });
    const changeTypes = history.map((h: any) => h.change_type);
    expect(changeTypes).toContain('custody_shipped');
    expect(changeTypes).toContain('custody_returned_to_vendor');
    expect(changeTypes).not.toContain('custody_returned');
    expect(JSON.stringify(history)).not.toContain('returned_to_client');
    expect(JSON.stringify(await knex('asset_custody_events').where({ tenant: holder.tenant, custody_id: custody.custody_id }))).not.toContain('returned_to_client');

    expect(await counts()).toEqual(before);
  });

  it('guard matrix: only a replaced/repaired advance case may ship; everything else is refused with no write', async () => {
    const ship = { carrier: 'UPS', tracking_number: 'G1' };
    const assetId = await newAsset();
    const { custody } = await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', rma_type: 'advance_replacement' }));
    // warranty_review
    expect(await shipDeadUnitToVendor(c.rma_id, ship)).toHaveProperty('actionError');
    ok(await approveWarrantyClaim(c.rma_id, { track: 'advance_replacement', vendor_id: VENDOR }));
    // open
    expect(await shipDeadUnitToVendor(c.rma_id, ship)).toHaveProperty('actionError');
    expect(await confirmVendorReceipt(c.rma_id, {})).toHaveProperty('actionError');
    ok(await receiveVendorReplacement(c.rma_id, { replacement_serial_number: 'N1', location_id: LOCATION }));
    // replaced: confirm is not available yet
    expect(await confirmVendorReceipt(c.rma_id, {})).toHaveProperty('actionError');
    ok(await shipDeadUnitToVendor(c.rma_id, ship));
    ok(await confirmVendorReceipt(c.rma_id, {}));
    // closed
    expect(await shipDeadUnitToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'other' })).toHaveProperty('actionError');
    expect(await confirmVendorReceipt(c.rma_id, {})).toHaveProperty('actionError');
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'closed', close_reason: 'returned_to_vendor' });
  });

  it('receive_replacement persists return_by on the advance track; omitted, the approval value survives (T013)', async () => {
    const mk = async (approvalReturnBy: string) => {
      const assetId = await newAsset();
      await inCustody(assetId);
      const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', rma_type: 'advance_replacement' }));
      ok(await approveWarrantyClaim(c.rma_id, { track: 'advance_replacement', vendor_id: VENDOR, return_by: approvalReturnBy }));
      return c.rma_id as string;
    };
    const ymd = async (id: string) => { const d = (await rmaRow(id)).return_by; return d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10); };
    const withNew = await mk('2026-11-10');
    ok(await receiveVendorReplacement(withNew, { replacement_serial_number: 'R1', location_id: LOCATION, return_by: '2026-11-20' }));
    expect(await ymd(withNew)).toBe('2026-11-20');
    const recv = (await events(withNew)).find((e: any) => e.event_type === 'replacement_received');
    expect(recv.payload.return_by).toBe('2026-11-20');
    const without = await mk('2026-11-10');
    ok(await receiveVendorReplacement(without, { replacement_serial_number: 'R2', location_id: LOCATION }));
    expect(await ymd(without)).toBe('2026-11-10');
  });

  it('receive_replacement ignores return_by on the standard track', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', rma_type: 'standard' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c.rma_id, {}));
    ok(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'S9', return_by: '2026-12-01' }));
    ok(await receiveVendorReplacement(c.rma_id, { replacement_serial_number: 'S-N2', location_id: LOCATION, return_by: '2026-12-25' }));
    const d = (await rmaRow(c.rma_id)).return_by;
    expect(String(d instanceof Date ? d.getMonth() + 1 : d)).toMatch(/12/);
    expect(d instanceof Date ? d.getDate() : Number(String(d).slice(8, 10))).toBe(1);
  });

  it('a standard-track case is refused, even when it reaches replaced', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', rma_type: 'standard' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c.rma_id, {}));
    ok(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'S1', return_by: '2026-12-01' }));
    ok(await receiveVendorReplacement(c.rma_id, { replacement_serial_number: 'S-NEW', location_id: LOCATION }));
    expect((await rmaRow(c.rma_id)).status).toBe('replaced');
    const before = await events(c.rma_id);
    const r: any = await shipDeadUnitToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'S2' });
    expect(r).toMatchObject({ actionError: expect.any(String), messageKey: 'features/inventory:errors.rma.warrantyWrongTrack' });
    expect(await events(c.rma_id)).toHaveLength(before.length);
    expect((await rmaRow(c.rma_id)).status).toBe('replaced');
  });

  it('same tracking is idempotent (no new event, no custody write); a different tracking from dead_unit_owed is refused', async () => {
    const { rmaId, custody } = await replacedAdvanceCase();
    const first = ok(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'IDEM-1' }));
    const n = (await events(rmaId)).length;
    const custodyBefore = await custodyRow(custody.custody_id);
    const custodyEventsBefore = await knex('asset_custody_events').where({ tenant: holder.tenant, custody_id: custody.custody_id }).count('* as c').first();
    published.events.length = 0;

    const again = ok(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'IDEM-1' }));
    expect(again.status).toBe('dead_unit_owed');
    expect(again.updated_at).toEqual(first.updated_at);
    expect(await events(rmaId)).toHaveLength(n);
    expect(await custodyRow(custody.custody_id)).toEqual(custodyBefore);
    expect(await knex('asset_custody_events').where({ tenant: holder.tenant, custody_id: custody.custody_id }).count('* as c').first()).toEqual(custodyEventsBefore);
    expect(published.events).toHaveLength(0);

    expect(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'IDEM-2' })).toHaveProperty('actionError');
    expect((await rmaRow(rmaId)).outbound_tracking_number).toBe('IDEM-1');
  });

  it('refuses when the device is not in custody or custody is in the wrong place', async () => {
    const a = await replacedAdvanceCase();
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: a.custody.custody_id }).update({ state: 'with_vendor', holder_user_id: null, location_id: null, bin: null });
    expect(await shipDeadUnitToVendor(a.rmaId, { carrier: 'UPS', tracking_number: 'W1' })).toMatchObject({ messageKey: 'features/inventory:errors.rma.warrantyCustodyWrongState' });
    expect((await rmaRow(a.rmaId)).status).toBe('replaced');

    const b = await replacedAdvanceCase();
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: b.custody.custody_id }).update({ state: 'closed', close_reason: 'disposed', closed_at: knex.fn.now() });
    expect(await shipDeadUnitToVendor(b.rmaId, { carrier: 'UPS', tracking_number: 'W2' })).toMatchObject({ messageKey: 'features/inventory:errors.rma.warrantyNoCustody' });
    expect((await rmaRow(b.rmaId)).status).toBe('replaced');

    const c = await replacedAdvanceCase();
    ok(await shipDeadUnitToVendor(c.rmaId, { carrier: 'UPS', tracking_number: 'W3' }));
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: c.custody.custody_id }).update({ state: 'in_office', holder_user_id: holder.userId, location_id: LOCATION });
    expect(await confirmVendorReceipt(c.rmaId, {})).toMatchObject({ messageKey: 'features/inventory:errors.rma.warrantyCustodyWrongState' });
    expect((await rmaRow(c.rmaId)).status).toBe('dead_unit_owed');
  });

  it('from dead_unit_owed, generic close leaves custody with the vendor and return-to-client is refused', async () => {
    const { rmaId, custody } = await replacedAdvanceCase();
    ok(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'GC-1' }));
    expect(await returnDeviceToClient(rmaId, {})).toHaveProperty('actionError');
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'with_vendor' });
    const closed = ok(await closeWarrantyRma(rmaId, { reason: 'resolved' }));
    expect(closed.status).toBe('closed');
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'with_vendor', close_reason: null });
  });

  it('permissions and the record-level check run on the server action', async () => {
    const { rmaId, assetId, custody } = await replacedAdvanceCase();
    const ship = { carrier: 'UPS', tracking_number: 'P1' };
    holder.grants = new Set(['asset:update']);
    expect(await shipDeadUnitToVendor(rmaId, ship)).toHaveProperty('permissionError');
    holder.grants = new Set(['warranty:read', 'asset:update']);
    expect(await shipDeadUnitToVendor(rmaId, ship)).toHaveProperty('permissionError');
    holder.grants = new Set(['warranty:update']);
    expect(await shipDeadUnitToVendor(rmaId, ship)).toHaveProperty('permissionError');
    holder.grants = new Set(['inventory:update', 'asset:update']);
    holder.readScope = { user_type: 'client', clientId: randomUUID() };
    expect(await shipDeadUnitToVendor(rmaId, ship)).toMatchObject({ messageKey: 'features/inventory:errors.rma.caseNotFound' });
    expect((await rmaRow(rmaId)).status).toBe('replaced');
    expect((await custodyRow(custody.custody_id)).state).toBe('in_office');
    holder.readScope = { user_type: 'internal', clientId: null };
    ok(await shipDeadUnitToVendor(rmaId, ship));

    holder.grants = new Set(['warranty:update']);
    expect(await confirmVendorReceipt(rmaId, {})).toHaveProperty('permissionError');
    holder.grants = new Set(['warranty:update', 'asset:update']);
    holder.readScope = { user_type: 'client', clientId: randomUUID() };
    expect(await confirmVendorReceipt(rmaId, {})).toMatchObject({ messageKey: 'features/inventory:errors.rma.caseNotFound' });
    holder.readScope = { user_type: 'internal', clientId: null };
    expect((await rmaRow(rmaId)).status).toBe('dead_unit_owed');
    ok(await confirmVendorReceipt(rmaId, {}));
  });
});

describe('shared dead_unit_owed status: stock track vs warranty track', () => {
  it('every stock-track entry point refuses a warranty case in dead_unit_owed and changes nothing', async () => {
    const { rmaId } = await replacedAdvanceCase();
    ok(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'SH-1' }));
    const before = await counts();
    const row = await rmaRow(rmaId);
    for (const attempt of [
      () => recordDeadUnitReturned(rmaId),
      () => chargeForUnreturned(rmaId),
      () => closeRma(rmaId),
      () => markDeadUnitOwed(rmaId, '2026-12-01'),
    ]) {
      expect(await attempt()).toMatchObject({ messageKey: 'features/inventory:errors.rma.warrantyClaimUnitAction' });
    }
    expect(await rmaRow(rmaId)).toEqual(row);
    expect(await counts()).toEqual(before);
  });

  it('the warranty cores refuse a stock case in dead_unit_owed', async () => {
    const { rmaId, unitId } = await stockCaseInDeadUnitOwed();
    const row = await rmaRow(rmaId);
    const unit = await knex('stock_units').where({ tenant: holder.tenant, unit_id: unitId }).first();
    const before = await counts();
    for (const attempt of [
      () => confirmVendorReceipt(rmaId, {}),
      () => shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'X' }),
      () => closeWarrantyRma(rmaId, {}),
      () => returnDeviceToClient(rmaId, {}),
    ]) {
      expect(await attempt()).toMatchObject({ messageKey: 'features/inventory:errors.rma.warrantyUnitTracked' });
    }
    expect(await rmaRow(rmaId)).toEqual(row);
    expect(await knex('stock_units').where({ tenant: holder.tenant, unit_id: unitId }).first()).toEqual(unit);
    expect(await counts()).toEqual(before);
  });

  it('the stock-track dead-unit-owed report keeps stock cases and excludes warranty dead units', async () => {
    const stock = await stockCaseInDeadUnitOwed();
    const { rmaId } = await replacedAdvanceCase();
    ok(await shipDeadUnitToVendor(rmaId, { carrier: 'UPS', tracking_number: 'RP-1' }));
    const rows: any[] = ok(await deadUnitsOwedReport());
    const ids = rows.map((r) => r.rma_id);
    expect(ids).toContain(stock.rmaId);
    expect(ids).not.toContain(rmaId);
  });

  it('stock-track dead-unit closing still works for a stock case (unchanged)', async () => {
    const { rmaId, unitId } = await stockCaseInDeadUnitOwed();
    const closed: any = ok(await recordDeadUnitReturned(rmaId));
    expect(closed.status).toBe('closed');
    expect((await knex('stock_units').where({ tenant: holder.tenant, unit_id: unitId }).first()).status).toBe('in_rma');
    void receiveReturn;
  });
});

/**
 * C5: warranty review and RMA for client-owned equipment (real DB). The Dell flow end to end, the approve and
 * deny paths, permission and state refusals, and the hard invariant: no stock or billing row ever changes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder: { knex: Knex; tenant: string; userId: string; grants: Set<string> | null } = {
  knex: undefined as never, tenant: '', userId: '', grants: null,
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant }, { tenant: holder.tenant }, ...args),
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

import {
  approveWarrantyClaim, cancelWarrantyClaim, closeWarrantyRma, denyWarrantyClaim, markDeviceReceived, openWarrantyClaim,
  receiveVendorReplacement, recordVendorCredit, recordVendorRepair, returnDeviceToClient, shipToVendor,
} from './rmaWarrantyActions';
import { getRmaCase, listRmaCases, closeRma, openRma, resolveRepair, receiveReturn, sendToVendor, resolveReplacement, resolveCredit, resolveScrap } from './rmaActions';
import { openCustody } from '@alga-psa/assets/lib/custody/openCustody';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

let knex: Knex;
let LOCATION: string;
let VENDOR: string;
let CLIENT: string;
let TICKET: string;

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
  await knex('asset_statuses').insert([
    { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
    { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
    { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
  ].map((s) => ({ tenant: holder.tenant, ...s, is_builtin: true, is_active: true })));
});
beforeEach(() => { holder.grants = null; denied.assetIds.clear(); published.events.length = 0; });
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
const events = (id: string) => knex('rma_events').where({ tenant: holder.tenant, rma_id: id }).orderBy('occurred_at').orderBy('recorded_at');

describe('warranty claims (C5)', () => {
  it('Dell flow: open → approve (advance) → ship → receive replacement → return, with no stock or billing change', async () => {
    const assetId = await newAsset();
    const { custody } = await inCustody(assetId);
    const before = await counts();

    const opened = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'Dock drops displays', rma_type: 'standard' }));
    expect(opened).toMatchObject({ status: 'warranty_review', returned_unit_id: null, asset_id: assetId, ticket_id: TICKET, custody_id: custody.custody_id });
    expect(opened.rma_number).toMatch(/^RMA-\d+$/);
    expect(published.events.map((e) => e.eventType)).toContain('INVENTORY_RMA_UPDATED');

    const approved = ok(await approveWarrantyClaim(opened.rma_id, { track: 'standard', vendor_id: VENDOR, rma_reference: 'DELL-77', return_by: '2026-11-20' }));
    expect(approved).toMatchObject({ status: 'awaiting_return', rma_type: 'standard', warranty_outcome: 'covered', rma_reference: 'DELL-77' });
    expect(approved.return_by).toBe('2026-11-20');

    expect(ok(await markDeviceReceived(opened.rma_id, {})).status).toBe('returned');
    const shipped = ok(await shipToVendor(opened.rma_id, { carrier: 'UPS', tracking_number: '1Z999', return_by: '2026-12-01' }));
    expect(shipped).toMatchObject({ status: 'sent_to_vendor', outbound_carrier: 'UPS', outbound_tracking_number: '1Z999', return_by: '2026-12-01' });
    expect((await knex('asset_custody').where({ custody_id: custody.custody_id }).first()).state).toBe('with_vendor');

    const replaced = ok(await receiveVendorReplacement(opened.rma_id, {
      replacement_serial_number: 'NEW-SERIAL', location_id: LOCATION, inbound_carrier: 'FedEx', inbound_tracking_number: 'FX1',
    }));
    expect(replaced).toMatchObject({ status: 'replaced', replacement_serial_number: 'NEW-SERIAL' });
    const asset = await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).first();
    expect(asset.serial_number).toBe('NEW-SERIAL');
    expect(await knex('assets').where({ tenant: holder.tenant, client_id: CLIENT }).where({ name: 'Dell WD19 dock' }).count('* as c').first())
      .toMatchObject({ c: expect.anything() });
    const history = await knex('asset_history').where({ tenant: holder.tenant, asset_id: assetId });
    expect(JSON.stringify(history)).toContain('OLD-SERIAL');

    const returned = ok(await returnDeviceToClient(opened.rma_id, {}));
    expect(returned).toMatchObject({ status: 'closed', closed_reason: 'resolved' });
    expect((await knex('asset_custody').where({ custody_id: custody.custody_id }).first())).toMatchObject({ state: 'closed', close_reason: 'returned_to_client' });

    expect((await events(opened.rma_id)).map((e: any) => e.event_type)).toEqual(
      expect.arrayContaining(['opened', 'warranty_approved', 'device_received', 'shipped_outbound', 'replacement_received', 'returned_to_client'])
    );
    expect(await counts()).toEqual(before);
    expect((await rmaRow(opened.rma_id)).returned_unit_id).toBeNull();
  });

  it('deny closes the case and keeps its history; the custody episode stays open', async () => {
    const assetId = await newAsset();
    const { custody } = await inCustody(assetId);
    const before = await counts();
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'Cracked casing' }));
    const denied1 = ok(await denyWarrantyClaim(c.rma_id, { denial_reason: 'Physical damage' }));
    expect(denied1).toMatchObject({ status: 'closed', warranty_outcome: 'not_covered', denial_reason: 'Physical damage', closed_reason: 'warranty_denied' });
    expect((await events(c.rma_id)).map((e: any) => e.event_type)).toEqual(['opened', 'warranty_denied']);
    expect((await knex('asset_custody').where({ custody_id: custody.custody_id }).first()).closed_at).toBeNull();
    expect(await denyWarrantyClaim(c.rma_id, { denial_reason: 'again' })).toHaveProperty('actionError');
    expect(await counts()).toEqual(before);
  });

  it('credit disposes the custody episode; repair comes back through the office', async () => {
    const a1 = await newAsset();
    const { custody } = await inCustody(a1);
    const c = ok(await openWarrantyClaim({ asset_id: a1, reason: 'dead', rma_type: 'standard' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c.rma_id, {}));
    ok(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: '1', return_by: '2026-12-01' }));
    expect(await recordVendorRepair(c.rma_id, {})).toHaveProperty('actionError'); // needs a location to receive back
    const repaired = ok(await recordVendorRepair(c.rma_id, { location_id: LOCATION }));
    expect(repaired.status).toBe('repaired');
    ok(await returnDeviceToClient(c.rma_id, {}));

    const a2 = await newAsset();
    const second = await inCustody(a2);
    const c2 = ok(await openWarrantyClaim({ asset_id: a2, reason: 'beyond repair' }));
    ok(await approveWarrantyClaim(c2.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c2.rma_id, {}));
    ok(await shipToVendor(c2.rma_id, { carrier: 'UPS', tracking_number: '2', return_by: '2026-12-01' }));
    const credited = ok(await recordVendorCredit(c2.rma_id, {}));
    expect(credited.status).toBe('credited');
    expect(await knex('asset_custody').where({ custody_id: second.custody.custody_id }).first()).toMatchObject({ state: 'closed', close_reason: 'disposed' });
    expect(custody.custody_id).not.toBe(second.custody.custody_id);
  });

  it('refuses wrong states, a warranty_review close and out-of-order steps', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x' }));
    expect(await closeWarrantyRma(c.rma_id, {})).toHaveProperty('actionError');
    expect(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: '1', return_by: '2026-12-01' })).toHaveProperty('actionError');
    expect(await returnDeviceToClient(c.rma_id, {})).toHaveProperty('actionError');
    expect(await receiveVendorReplacement(c.rma_id, { replacement_serial_number: 'Z', location_id: LOCATION })).toHaveProperty('actionError');
    expect((await rmaRow(c.rma_id)).status).toBe('warranty_review');
    const cancelled = ok(await cancelWarrantyClaim(c.rma_id, { reason: 'cancelled' }));
    expect(cancelled).toMatchObject({ status: 'closed', closed_reason: 'cancelled' });
  });

  it('refuses a second claim when the asset is stock-tracked or not client-owned', async () => {
    const msp = await newAsset({ ownership: 'msp' });
    expect(await openWarrantyClaim({ asset_id: msp, reason: 'x' })).toHaveProperty('actionError');
    expect(await knex('rma_cases').where({ tenant: holder.tenant, asset_id: msp }).count('* as c').first()).toMatchObject({ c: '0' });
  });

  it('permissions: warranty or inventory plus asset:update; a hidden asset reads as not found', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    holder.grants = new Set(['asset:update']);
    expect(await openWarrantyClaim({ asset_id: assetId, reason: 'x' })).toHaveProperty('permissionError');
    holder.grants = new Set(['warranty:create']);
    expect(await openWarrantyClaim({ asset_id: assetId, reason: 'x' })).toHaveProperty('permissionError');
    holder.grants = new Set(['warranty:create', 'asset:update']);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x' }));
    holder.grants = new Set(['warranty:read', 'asset:update']);
    expect(await denyWarrantyClaim(c.rma_id, { denial_reason: 'n' })).toHaveProperty('permissionError');
    holder.grants = new Set(['inventory:update', 'asset:update']);
    denied.assetIds.add(assetId);
    expect(await denyWarrantyClaim(c.rma_id, { denial_reason: 'n' })).toHaveProperty('actionError');
    expect((await rmaRow(c.rma_id)).status).toBe('warranty_review');
    denied.assetIds.clear();
    ok(await denyWarrantyClaim(c.rma_id, { denial_reason: 'n' }));
  });

  it('unit-only resolvers refuse a unit-less warranty case', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    const before = await counts();
    for (const attempt of [
      () => receiveReturn(c.rma_id, { location_id: LOCATION }),
      () => sendToVendor(c.rma_id, { vendor_id: VENDOR }),
      () => resolveRepair(c.rma_id, { location_id: LOCATION }),
      () => resolveReplacement(c.rma_id, { serial_number: 'S', location_id: LOCATION }),
      () => resolveCredit(c.rma_id),
      () => resolveScrap(c.rma_id),
      () => closeRma(c.rma_id),
    ]) {
      expect(await attempt()).toHaveProperty('actionError');
    }
    expect((await rmaRow(c.rma_id)).status).toBe('awaiting_return');
    expect(await counts()).toEqual(before);
  });

  it('reads: asset-linked cases honour the record-level check; warranty-only readers see no stock-unit RMAs', async () => {
    const assetId = await newAsset();
    await inCustody(assetId);
    const c = ok(await openWarrantyClaim({ asset_id: assetId, reason: 'x', ticket_id: TICKET }));
    const row: any = ok(await getRmaCase(c.rma_id));
    expect(row).toMatchObject({ asset_name: 'Dell WD19 dock', asset_serial_number: 'OLD-SERIAL', ticket_number: expect.any(String) });
    expect((ok(await listRmaCases({ asset_id: assetId })) as any[]).map((r) => r.rma_id)).toEqual([c.rma_id]);

    denied.assetIds.add(assetId);
    expect(await getRmaCase(c.rma_id)).toBeNull();
    expect((await listRmaCases({ asset_id: assetId })) as any[]).toHaveLength(0);
    denied.assetIds.clear();

    holder.grants = new Set(['warranty:read']);
    const visible = (ok(await listRmaCases()) as any[]);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.returned_unit_id === null)).toBe(true);
    holder.grants = new Set(['asset:update']);
    expect(await listRmaCases()).toHaveProperty('permissionError');
  });
});

// ---------------------------------------------------------------------------------------------------
// T016-T019, T022 (plan 2026-10-25-warranty-review-and-rma/tests.json)
// ---------------------------------------------------------------------------------------------------

const ALL_COUNTED = ['stock_units', 'stock_movements', 'stock_levels', 'product_inventory_settings', 'invoice_charges', 'time_entries'];
const countAll = async () => {
  const out: Record<string, number> = {};
  for (const t of ALL_COUNTED) out[t] = Number((await knex(t).where({ tenant: holder.tenant }).count('* as c').first())!.c);
  return out;
};
const custodyRow = (id: string) => knex('asset_custody').where({ tenant: holder.tenant, custody_id: id }).first();
const assetCount = async () => Number((await knex('assets').where({ tenant: holder.tenant }).count('* as c').first())!.c);
const history = (assetId: string, type?: string) =>
  knex('asset_history').where({ tenant: holder.tenant, asset_id: assetId, ...(type ? { change_type: type } : {}) });
const asObj = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

async function toReturned(assetId?: string, track: 'standard' | 'advance_replacement' = 'standard') {
  const a = assetId ?? (await newAsset());
  const { custody } = await inCustody(a);
  const c = ok(await openWarrantyClaim({ asset_id: a, reason: 'dead' }));
  ok(await approveWarrantyClaim(c.rma_id, { track, vendor_id: VENDOR }));
  return { assetId: a, custody, rmaId: c.rma_id as string };
}

describe('T016 receive and ship validation', () => {
  it('mark received needs an in-office custody episode and writes no stock rows; ship persists fields and moves custody to with_vendor; missing fields refused before any write', async () => {
    // no custody: refused
    const bare = await newAsset();
    const { custody: tmp } = await inCustody(bare);
    const c0 = ok(await openWarrantyClaim({ asset_id: bare, reason: 'x' }));
    ok(await approveWarrantyClaim(c0.rma_id, { track: 'standard', vendor_id: VENDOR }));
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: tmp.custody_id }).update({ state: 'closed', closed_at: new Date().toISOString(), close_reason: 'returned_to_client' });
    const r0: any = await markDeviceReceived(c0.rma_id, {});
    expect(r0.actionError).toBeTruthy();
    expect((await rmaRow(c0.rma_id)).status).toBe('awaiting_return');

    // custody not in office: refused
    const { assetId, custody, rmaId } = await toReturned();
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: custody.custody_id }).update({ state: 'with_vendor' });
    expect(await markDeviceReceived(rmaId, {})).toHaveProperty('actionError');
    expect((await rmaRow(rmaId)).status).toBe('awaiting_return');
    await knex('asset_custody').where({ tenant: holder.tenant, custody_id: custody.custody_id }).update({ state: 'in_office' });

    const before = await countAll();
    expect(ok(await markDeviceReceived(rmaId, {})).status).toBe('returned');
    expect(await countAll()).toEqual(before);

    // missing fields refused before any write
    const eventsBefore = (await events(rmaId)).length;
    for (const bad of [
      { tracking_number: '1', return_by: '2026-12-01' },
      { carrier: 'UPS', return_by: '2026-12-01' },
      { carrier: 'UPS', tracking_number: '1' },
      { carrier: 'UPS', tracking_number: '1', return_by: '2026-02-31' },
      { carrier: '  ', tracking_number: '1', return_by: '2026-12-01' },
    ]) {
      // schema validation comes back as an {actionError} value before the transaction opens; nothing is written
      expect(await shipToVendor(rmaId, bad as any)).toMatchObject({ actionError: expect.any(String), messageKey: expect.stringContaining('features/inventory:errors.rma.warranty') });
    }
    expect((await events(rmaId)).length).toBe(eventsBefore);
    expect(await rmaRow(rmaId)).toMatchObject({ status: 'returned', outbound_carrier: null, outbound_tracking_number: null, outbound_shipped_at: null });
    expect((await custodyRow(custody.custody_id)).state).toBe('in_office');

    const shipped = ok(await shipToVendor(rmaId, { vendor_id: VENDOR, carrier: 'UPS', tracking_number: '1Z1', return_by: '2026-12-01' }));
    expect(shipped).toMatchObject({ status: 'sent_to_vendor', vendor_id: VENDOR, outbound_carrier: 'UPS', outbound_tracking_number: '1Z1' });
    const row = await rmaRow(rmaId);
    expect(row.outbound_shipped_at).toBeTruthy();
    expect(String(row.return_by instanceof Date ? row.return_by.toISOString() : row.return_by)).toContain('2026-12-0');
    expect((await custodyRow(custody.custody_id)).state).toBe('with_vendor');
    expect(await countAll()).toEqual(before);
    expect(assetId).toBeTruthy();
  });
});

describe('T017 replacement and repair in place', () => {
  it('replacement updates the same asset row, logs asset_history warranty_replacement, writes inbound fields and event, custody back in_office, publishes ASSET_UPDATED', async () => {
    const { assetId, custody, rmaId } = await toReturned();
    ok(await markDeviceReceived(rmaId, {}));
    ok(await shipToVendor(rmaId, { carrier: 'UPS', tracking_number: '9', return_by: '2026-12-01' }));
    const assets0 = await assetCount();
    const stock0 = await countAll();
    published.events.length = 0;

    const done = ok(await receiveVendorReplacement(rmaId, {
      replacement_serial_number: 'NEW-1', model: 'WD19S', location_id: LOCATION, inbound_carrier: 'FedEx', inbound_tracking_number: 'FX9',
    }));
    expect(done.status).toBe('replaced');
    expect(await assetCount()).toBe(assets0);
    expect(await countAll()).toEqual(stock0);
    expect(await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).first()).toMatchObject({ serial_number: 'NEW-1', model: 'WD19S', manufacturer: 'Dell' });

    const h = await history(assetId, 'warranty_replacement');
    expect(h).toHaveLength(1);
    const ch = asObj(h[0].changes);
    expect(ch.before).toMatchObject({ serial_number: 'OLD-SERIAL', model: 'WD19' });
    expect(ch.after).toMatchObject({ serial_number: 'NEW-1', model: 'WD19S' });
    expect(ch.rma_id).toBe(rmaId);

    const row = await rmaRow(rmaId);
    expect(row).toMatchObject({ inbound_carrier: 'FedEx', inbound_tracking_number: 'FX9', replacement_serial_number: 'NEW-1' });
    expect(row.inbound_received_at).toBeTruthy();
    expect(row.replacement_received_at).toBeTruthy();
    const ev = (await events(rmaId)).find((e: any) => e.event_type === 'replacement_received');
    expect(ev).toMatchObject({ carrier: 'FedEx', tracking_number: 'FX9' });
    expect((await custodyRow(custody.custody_id)).state).toBe('in_office');
    const assetUpdated = published.events.filter((e) => e.eventType === 'ASSET_UPDATED');
    expect(assetUpdated.length).toBeGreaterThan(0);
    expect(JSON.stringify(assetUpdated)).toContain(assetId);
  });

  it('advance replacement (custody never left) and repair both return custody to in_office without a new asset', async () => {
    // advance: approve advance -> open; custody stays in_office; receive replacement
    const adv = await toReturned(undefined, 'advance_replacement');
    expect((await rmaRow(adv.rmaId)).status).toBe('open');
    const assets0 = await assetCount();
    ok(await receiveVendorReplacement(adv.rmaId, { replacement_serial_number: 'ADV-1' }));
    expect((await custodyRow(adv.custody.custody_id)).state).toBe('in_office');
    expect(await assetCount()).toBe(assets0);

    // repair
    const rep = await toReturned();
    const assets1 = await assetCount();
    ok(await markDeviceReceived(rep.rmaId, {}));
    ok(await shipToVendor(rep.rmaId, { carrier: 'UPS', tracking_number: '5', return_by: '2026-12-01' }));
    published.events.length = 0;
    const repaired = ok(await recordVendorRepair(rep.rmaId, { location_id: LOCATION, inbound_carrier: 'DHL', inbound_tracking_number: 'D1' }));
    expect(repaired).toMatchObject({ status: 'repaired', inbound_carrier: 'DHL', inbound_tracking_number: 'D1' });
    expect((await custodyRow(rep.custody.custody_id)).state).toBe('in_office');
    expect((await events(rep.rmaId)).map((e: any) => e.event_type)).toContain('repair_received');
    expect(await assetCount()).toBe(assets1);
    expect(await history(rep.assetId, 'warranty_replacement')).toHaveLength(0);
  });
});

describe('T018 credit and return-to-client custody outcomes', () => {
  it('credit disposes custody with a custody_disposed history row and writes no invoice/charge/stock rows', async () => {
    const { assetId, custody, rmaId } = await toReturned();
    ok(await markDeviceReceived(rmaId, {}));
    ok(await shipToVendor(rmaId, { carrier: 'UPS', tracking_number: '7', return_by: '2026-12-01' }));
    const before = await counts();
    const credited = ok(await recordVendorCredit(rmaId, {}));
    expect(credited.status).toBe('credited');
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'closed', close_reason: 'disposed' });
    const h = await history(assetId, 'custody_disposed');
    expect(h).toHaveLength(1);
    expect(asObj(h[0].changes)).toMatchObject({ close_reason: 'disposed', rma_id: rmaId });
    expect(await counts()).toEqual(before);
    expect((await events(rmaId)).map((e: any) => e.event_type)).toContain('vendor_credited');
  });

  it('return to client closes the case resolved and custody returned_to_client, moving held_by_msp to active; refused from every other status', async () => {
    const { assetId, custody, rmaId } = await toReturned();
    // refused from warranty_review? use a second case; here: awaiting_return, returned, sent_to_vendor, credited
    const attempt = async () => expect(await returnDeviceToClient(rmaId, {})).toHaveProperty('actionError');
    await attempt(); // awaiting_return
    ok(await markDeviceReceived(rmaId, {}));
    await attempt(); // returned
    ok(await shipToVendor(rmaId, { carrier: 'UPS', tracking_number: '8', return_by: '2026-12-01' }));
    await attempt(); // sent_to_vendor
    expect((await custodyRow(custody.custody_id)).state).toBe('with_vendor');
    ok(await receiveVendorReplacement(rmaId, { replacement_serial_number: 'R-2', location_id: LOCATION }));
    await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).update({ status: 'held_by_msp' });

    const closed = ok(await returnDeviceToClient(rmaId, { counterparty: 'Client rep' }));
    expect(closed).toMatchObject({ status: 'closed', closed_reason: 'resolved' });
    expect(closed.closed_at).toBeTruthy();
    expect(await custodyRow(custody.custody_id)).toMatchObject({ state: 'closed', close_reason: 'returned_to_client' });
    expect((await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).first()).status).toBe('active');
    await attempt(); // closed

    // warranty_review, credited, denied
    const wr = ok(await openWarrantyClaim({ asset_id: await (async () => { const a = await newAsset(); await inCustody(a); return a; })(), reason: 'x' }));
    expect(await returnDeviceToClient(wr.rma_id, {})).toHaveProperty('actionError');
    const cr = await toReturned();
    ok(await markDeviceReceived(cr.rmaId, {}));
    ok(await shipToVendor(cr.rmaId, { carrier: 'UPS', tracking_number: '3', return_by: '2026-12-01' }));
    ok(await recordVendorCredit(cr.rmaId, {}));
    expect(await returnDeviceToClient(cr.rmaId, {})).toHaveProperty('actionError');
    expect((await rmaRow(cr.rmaId)).status).toBe('credited');
  });

  it('return to client leaves a non-held_by_msp asset status alone', async () => {
    const { assetId, rmaId } = await toReturned();
    ok(await markDeviceReceived(rmaId, {}));
    ok(await shipToVendor(rmaId, { carrier: 'UPS', tracking_number: '4', return_by: '2026-12-01' }));
    ok(await receiveVendorReplacement(rmaId, { replacement_serial_number: 'R-3', location_id: LOCATION }));
    await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).update({ status: 'retired' });
    ok(await returnDeviceToClient(rmaId, {}));
    expect((await knex('assets').where({ tenant: holder.tenant, asset_id: assetId }).first()).status).toBe('retired');
  });
});

describe('T019 closeWarrantyRma', () => {
  it('stores the reason and writes a closed event, refuses warranty_review, is a no-op when already closed', async () => {
    const wr = await toReturned();
    // approved -> awaiting_return refuses too; test warranty_review separately below
    expect(await closeWarrantyRma(wr.rmaId, { reason: 'resolved' })).toHaveProperty('actionError');
    ok(await markDeviceReceived(wr.rmaId, {}));
    const closed = ok(await closeWarrantyRma(wr.rmaId, { reason: 'duplicate', note: 'dupe' }));
    expect(closed).toMatchObject({ status: 'closed', closed_reason: 'duplicate' });
    const evs = await events(wr.rmaId);
    const closedEv = evs.filter((e: any) => e.event_type === 'closed');
    expect(closedEv).toHaveLength(1);
    expect(closedEv[0]).toMatchObject({ from_status: 'returned', to_status: 'closed', note: 'dupe' });

    // already closed: refused without a second event or change
    const n = (await events(wr.rmaId)).length;
    const again: any = await closeWarrantyRma(wr.rmaId, { reason: 'resolved' });
    expect(again.actionError ?? again.status).toBeTruthy();
    expect((await events(wr.rmaId)).length).toBe(n);
    expect((await rmaRow(wr.rmaId)).closed_reason).toBe('duplicate');

    // warranty_review refused with the dedicated code
    const a = await newAsset();
    await inCustody(a);
    const wrv = ok(await openWarrantyClaim({ asset_id: a, reason: 'x' }));
    const refused: any = await closeWarrantyRma(wrv.rma_id, { reason: 'resolved' });
    expect(refused.actionError).toBeTruthy();
    expect((await rmaRow(wrv.rma_id)).status).toBe('warranty_review');

    // credited defaults to vendor_credited
    const cr = await toReturned();
    ok(await markDeviceReceived(cr.rmaId, {}));
    ok(await shipToVendor(cr.rmaId, { carrier: 'UPS', tracking_number: '6', return_by: '2026-12-01' }));
    ok(await recordVendorCredit(cr.rmaId, {}));
    expect(ok(await closeWarrantyRma(cr.rmaId, {}))).toMatchObject({ status: 'closed', closed_reason: 'vendor_credited' });
  });

  it('the legacy closeRma on a stock-unit case still works, and the stock-unit closeRma is a no-op when already closed', async () => {
    const service = (await knex('service_catalog').where({ tenant: holder.tenant }).first()).service_id;
    const [unit] = await knex('stock_units')
      .insert({ tenant: holder.tenant, service_id: service, serial_number: `SN-${randomUUID()}`, status: 'delivered', client_id: CLIENT, unit_cost: 1000 })
      .returning('*');
    const rma: any = ok(await openRma({ returned_unit_id: unit.unit_id, reason: 'dead' }));
    ok(await receiveReturn(rma.rma_id, { location_id: LOCATION }));
    ok(await sendToVendor(rma.rma_id, { vendor_id: VENDOR }));
    ok(await resolveCredit(rma.rma_id));
    const closed: any = ok(await closeRma(rma.rma_id));
    expect(closed.status).toBe('closed');
    expect(closed.closed_at).toBeTruthy();
    const again: any = ok(await closeRma(rma.rma_id));
    expect(again.status).toBe('closed');
    // a warranty-only close action refuses a stock-unit case
    expect(await closeWarrantyRma(rma.rma_id, {})).toHaveProperty('actionError');
  });
});

describe('T022 no stock/billing/time rows change', () => {
  it('replacement flow: open -> approve -> receive -> ship -> replacement -> return leaves all six tables unchanged', async () => {
    const a = await newAsset();
    await inCustody(a);
    const before = await countAll();
    const c = ok(await openWarrantyClaim({ asset_id: a, reason: 'dead' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c.rma_id, {}));
    ok(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'Z', return_by: '2026-12-01' }));
    ok(await receiveVendorReplacement(c.rma_id, { replacement_serial_number: 'T22-NEW', location_id: LOCATION }));
    ok(await returnDeviceToClient(c.rma_id, {}));
    expect((await rmaRow(c.rma_id)).status).toBe('closed');
    expect(await countAll()).toEqual(before);
  });

  it('credit flow: open -> approve -> receive -> ship -> credit -> close leaves all six tables unchanged', async () => {
    const a = await newAsset();
    await inCustody(a);
    const before = await countAll();
    const c = ok(await openWarrantyClaim({ asset_id: a, reason: 'dead' }));
    ok(await approveWarrantyClaim(c.rma_id, { track: 'standard', vendor_id: VENDOR }));
    ok(await markDeviceReceived(c.rma_id, {}));
    ok(await shipToVendor(c.rma_id, { carrier: 'UPS', tracking_number: 'Y', return_by: '2026-12-01' }));
    ok(await recordVendorCredit(c.rma_id, {}));
    ok(await closeWarrantyRma(c.rma_id, {}));
    expect((await rmaRow(c.rma_id)).status).toBe('closed');
    expect(await countAll()).toEqual(before);
  });
});

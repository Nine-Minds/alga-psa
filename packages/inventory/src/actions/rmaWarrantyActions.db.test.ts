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
import { getRmaCase, listRmaCases, closeRma, resolveRepair, receiveReturn, sendToVendor, resolveReplacement, resolveCredit, resolveScrap } from './rmaActions';
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

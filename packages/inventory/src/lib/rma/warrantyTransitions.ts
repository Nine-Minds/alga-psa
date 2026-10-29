import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { SharedNumberingService } from '@alga-psa/shared/services/numberingService';
import type { IAssetCustody, IRmaCase, IRmaEvent } from '@alga-psa/types';
import { recordCustodyEvent } from '@alga-psa/assets/lib/custody/recordCustodyEvent';
import { closeCustodyEpisode } from '@alga-psa/assets/lib/custody/closeCustodyEpisode';
import { loadCustody } from '@alga-psa/assets/lib/custody/shared';
import { applyWarrantyReplacement } from '@alga-psa/assets/lib/warranty/applyWarrantyReplacement';
import { assertWarrantyTransition, isAssetTracked, RmaTransitionError, type WarrantyAction } from './stateMachine';
import { recordRmaEvent } from './recordRmaEvent';
import type {
  ApproveWarrantyClaimInput,
  CancelWarrantyClaimInput,
  CloseWarrantyRmaInput,
  DenyWarrantyClaimInput,
  MarkDeviceReceivedInput,
  OpenWarrantyClaimInput,
  ReceiveVendorReplacementInput,
  RecordVendorCreditInput,
  RecordVendorRepairInput,
  ReturnDeviceToClientInput,
  ShipToVendorInput,
} from './warrantySchemas';

/**
 * Transaction-taking cores for warranty transitions 1–13 (C5 PRD). Every function runs inside the caller's
 * transaction, takes the `rma_cases` row FOR UPDATE, asserts the transition through the pure state machine,
 * writes exactly one `rma_events` row, and returns what the caller must publish after commit.
 *
 * HARD RULE: this module never imports or calls the stock movement primitive, never reads `rmaServiceId`, and
 * never touches `stock_units` / `stock_movements` / `stock_levels`. Custody is written only through C4's cores
 * (`recordCustodyEvent`) and the one C5 extension (`closeCustodyEpisode(..., 'disposed')`).
 */

export type WarrantyErrorCode =
  | 'not_found'
  | 'unit_tracked'
  | 'stock_tracked_asset'
  | 'not_client_owned'
  | 'no_custody'
  | 'custody_wrong_state'
  | 'vendor_required'
  | 'location_required'
  | 'invalid_transition'
  | 'warranty_review_close';

export class WarrantyError extends Error {
  constructor(public readonly code: WarrantyErrorCode, message: string) {
    super(message);
    this.name = 'WarrantyError';
  }
}

export interface WarrantyCustodyEffect {
  custody: IAssetCustody;
  eventType: 'shipped' | 'received' | 'returned' | 'disposed';
  occurredAt: string;
  assetStatusChange?: { assetId: string; before: string; after: string } | null;
}

export interface WarrantyAssetEffect {
  assetId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedPaths: string[];
}

export interface WarrantyTransitionResult {
  rma: IRmaCase;
  previousStatus: string | null;
  changedFields: string[];
  event: IRmaEvent;
  custodyEffects: WarrantyCustodyEffect[];
  assetEffect?: WarrantyAssetEffect;
  /** For the vendor-case external-link mirror and ticket display. */
  serialNumber?: string | null;
}

export interface WarrantyCoreOptions {
  /** Record-level asset check from the action layer. Throw to refuse; it runs after the lock, before any write. */
  authorizeAsset?: (assetId: string, clientId: string | null) => Promise<void>;
}


async function lockWarrantyRma(trx: Knex.Transaction, tenant: string, rmaId: string, options: WarrantyCoreOptions): Promise<IRmaCase> {
  const rma = (await tenantDb(trx, tenant).table('rma_cases').where({ rma_id: rmaId }).forUpdate().first()) as IRmaCase | undefined;
  if (!rma) throw new WarrantyError('not_found', 'RMA case not found');
  // Unit-tracked cases have their own writers; a warranty action must never reach them.
  if (!isAssetTracked(rma)) {
    throw new WarrantyError('unit_tracked', 'This RMA is for a stock unit. Use the stock-unit RMA actions.');
  }
  if (rma.asset_id && options.authorizeAsset) await options.authorizeAsset(rma.asset_id, rma.client_id ?? null);
  return rma;
}

function guard(rma: IRmaCase, action: WarrantyAction) {
  try {
    return assertWarrantyTransition(rma.status, action);
  } catch (error) {
    if (error instanceof RmaTransitionError) {
      throw new WarrantyError(error.code, error.message);
    }
    throw error;
  }
}

async function loadOpenCustody(trx: Knex.Transaction, tenant: string, rma: IRmaCase): Promise<IAssetCustody | null> {
  const db = tenantDb(trx, tenant);
  let custodyId = rma.custody_id ?? null;
  if (!custodyId && rma.asset_id) {
    const open = await db.table('asset_custody').where({ asset_id: rma.asset_id }).whereNull('closed_at').select('custody_id').first();
    custodyId = open?.custody_id ?? null;
  }
  if (!custodyId) return null;
  const custody = await loadCustody(trx, tenant, custodyId, { forUpdate: true });
  return custody.state === 'closed' ? null : custody;
}

async function vendorName(trx: Knex.Transaction, tenant: string, vendorId: string | null | undefined): Promise<string | null> {
  if (!vendorId) return null;
  const v = await tenantDb(trx, tenant).table('vendors').where({ vendor_id: vendorId }).select('vendor_name').first();
  if (!v) throw new WarrantyError('vendor_required', 'Vendor not found.');
  return v.vendor_name as string;
}

async function patch(trx: Knex.Transaction, tenant: string, rmaId: string, values: Record<string, unknown>): Promise<IRmaCase> {
  const [row] = await tenantDb(trx, tenant)
    .table('rma_cases')
    .where({ rma_id: rmaId })
    .update({ ...values, updated_at: trx.fn.now() })
    .returning('*');
  return row as IRmaCase;
}

function cleanPatch(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

async function conclude(
  trx: Knex.Transaction,
  tenant: string,
  actor: string,
  before: IRmaCase,
  action: WarrantyAction,
  values: Record<string, unknown>,
  eventExtras: {
    occurredAt?: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    note?: string | null;
    payload?: Record<string, unknown>;
  },
  rest: Partial<Pick<WarrantyTransitionResult, 'custodyEffects' | 'assetEffect' | 'serialNumber'>> = {}
): Promise<WarrantyTransitionResult> {
  const t = guard(before, action);
  const full = cleanPatch({ ...values, status: t.to, ...(t.closes ? { closed_at: trx.fn.now() } : {}) });
  const rma = await patch(trx, tenant, before.rma_id, full);
  const event = await recordRmaEvent(trx, tenant, {
    rmaId: before.rma_id,
    eventType: t.eventType,
    fromStatus: before.status,
    toStatus: t.to,
    actorUserId: actor,
    occurredAt: eventExtras.occurredAt,
    carrier: eventExtras.carrier,
    trackingNumber: eventExtras.trackingNumber,
    note: eventExtras.note,
    payload: eventExtras.payload,
  });
  return {
    rma,
    previousStatus: before.status,
    changedFields: Object.keys(full).filter((k) => k !== 'updated_at' && k !== 'closed_at').concat(t.closes ? ['closed_at'] : []),
    event,
    custodyEffects: rest.custodyEffects ?? [],
    assetEffect: rest.assetEffect,
    serialNumber: rest.serialNumber,
  };
}

// --- 1. open -----------------------------------------------------------------------------------

export async function openWarrantyClaimCore(
  trx: Knex.Transaction,
  tenant: string,
  actor: string,
  input: OpenWarrantyClaimInput,
  options: WarrantyCoreOptions = {}
): Promise<{ rma: IRmaCase; event: IRmaEvent; serialNumber: string | null }> {
  const db = tenantDb(trx, tenant);
  const asset = await db
    .table('assets')
    .where({ asset_id: input.asset_id })
    .select('asset_id', 'client_id', 'ownership', 'stock_unit_id', 'serial_number')
    .first();
  if (!asset) throw new WarrantyError('not_found', 'Asset not found.');
  if (options.authorizeAsset) await options.authorizeAsset(asset.asset_id, asset.client_id ?? null);
  if (asset.stock_unit_id) {
    throw new WarrantyError('stock_tracked_asset', 'This device was sold from stock. Open an RMA from its stock unit instead.');
  }
  if (asset.ownership === 'msp') {
    throw new WarrantyError('not_client_owned', 'Warranty claims are for client-owned equipment.');
  }
  await vendorName(trx, tenant, input.vendor_id);

  const open = await db.table('asset_custody').where({ asset_id: input.asset_id }).whereNull('closed_at').select('custody_id', 'ticket_id').first();
  const rmaNumber = await SharedNumberingService.getNextNumber('RMA', { knex: trx, tenant });
  const ticketId = open?.ticket_id ?? input.ticket_id ?? null;

  const [row] = await db
    .table('rma_cases')
    .insert({
      tenant,
      rma_number: rmaNumber,
      rma_type: input.rma_type,
      returned_unit_id: null,
      service_id: null,
      client_id: asset.client_id,
      asset_id: asset.asset_id,
      vendor_id: input.vendor_id,
      rma_reference: input.rma_reference,
      reason: input.reason,
      status: 'warranty_review',
      ticket_id: ticketId,
      custody_id: open?.custody_id ?? null,
      created_by: actor,
    })
    .returning('*');
  const rma = row as IRmaCase;
  const event = await recordRmaEvent(trx, tenant, {
    rmaId: rma.rma_id,
    eventType: 'opened',
    fromStatus: null,
    toStatus: 'warranty_review',
    actorUserId: actor,
    note: input.reason,
    payload: { asset_id: asset.asset_id, custody_id: open?.custody_id ?? null, ticket_id: ticketId, rma_type: input.rma_type },
  });
  return { rma, event, serialNumber: asset.serial_number ?? null };
}

// --- 2–5. decide ---------------------------------------------------------------------------------

export async function approveWarrantyClaimCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: ApproveWarrantyClaimInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  const action: WarrantyAction = input.track === 'standard' ? 'approve_standard' : 'approve_advance';
  guard(rma, action);
  const name = await vendorName(trx, tenant, input.vendor_id);
  return conclude(trx, tenant, actor, rma, action, {
    rma_type: input.track,
    warranty_outcome: 'covered',
    warranty_decided_at: input.occurred_at ?? new Date().toISOString(),
    warranty_decided_by: actor,
    vendor_id: input.vendor_id,
    rma_reference: input.rma_reference ?? rma.rma_reference ?? undefined,
    return_ship_to: input.return_ship_to ?? rma.return_ship_to ?? name,
    return_by: input.return_by ?? undefined,
  }, {
    occurredAt: input.occurred_at,
    note: input.note,
    payload: { track: input.track, vendor_id: input.vendor_id, rma_reference: input.rma_reference ?? rma.rma_reference ?? null },
  });
}

export async function denyWarrantyClaimCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: DenyWarrantyClaimInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  return conclude(trx, tenant, actor, rma, 'deny', {
    warranty_outcome: 'not_covered',
    warranty_decided_at: input.occurred_at ?? new Date().toISOString(),
    warranty_decided_by: actor,
    denial_reason: input.denial_reason,
    closed_reason: 'warranty_denied',
  }, { occurredAt: input.occurred_at, note: input.note, payload: { denial_reason: input.denial_reason } });
}

export async function cancelWarrantyClaimCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: CancelWarrantyClaimInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  return conclude(trx, tenant, actor, rma, 'cancel', { closed_reason: input.reason }, {
    occurredAt: input.occurred_at, note: input.note, payload: { closed_reason: input.reason },
  });
}

// --- 6. device received (asserts custody; writes none) --------------------------------------------

export async function markDeviceReceivedCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: MarkDeviceReceivedInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'mark_device_received');
  const custody = await loadOpenCustody(trx, tenant, rma);
  if (!custody) {
    throw new WarrantyError('no_custody', 'Receive the device into custody first (Receive equipment on the ticket or asset).');
  }
  if (custody.state !== 'in_office') {
    throw new WarrantyError('custody_wrong_state', 'The device is not in the office, so it cannot be marked received.');
  }
  return conclude(trx, tenant, actor, rma, 'mark_device_received', {
    custody_id: custody.custody_id,
    ticket_id: rma.ticket_id ?? custody.ticket_id ?? undefined,
  }, { occurredAt: input.occurred_at, note: input.note, payload: { custody_id: custody.custody_id } });
}

// --- 7. ship ---------------------------------------------------------------------------------------

export async function shipToVendorCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: ShipToVendorInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'ship_to_vendor');
  const vendorId = input.vendor_id ?? rma.vendor_id ?? null;
  if (!vendorId) throw new WarrantyError('vendor_required', 'Choose the vendor before shipping.');
  const name = await vendorName(trx, tenant, vendorId);
  const custody = await loadOpenCustody(trx, tenant, rma);
  if (!custody) throw new WarrantyError('no_custody', 'The device is not in custody, so it cannot be shipped.');
  if (custody.state !== 'in_office') {
    throw new WarrantyError('custody_wrong_state', 'The device is already out of the office.');
  }
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const custodyNote = [`${input.carrier} ${input.tracking_number}`, `RMA ${rma.rma_number}`, input.note].filter(Boolean).join(' · ');
  const shipped = await recordCustodyEvent(trx, tenant, actor, custody.custody_id, {
    event_type: 'shipped',
    counterparty: name ?? 'Vendor',
    occurred_at: occurredAt,
    note: custodyNote,
    document_ids: [],
  });
  return conclude(trx, tenant, actor, rma, 'ship_to_vendor', {
    vendor_id: vendorId,
    custody_id: custody.custody_id,
    outbound_carrier: input.carrier,
    outbound_tracking_number: input.tracking_number,
    outbound_shipped_at: occurredAt,
    return_by: input.return_by,
    rma_reference: input.rma_reference ?? rma.rma_reference ?? undefined,
    return_ship_to: input.return_ship_to ?? rma.return_ship_to ?? name,
  }, {
    occurredAt, carrier: input.carrier, trackingNumber: input.tracking_number, note: input.note,
    payload: { vendor_id: vendorId, return_by: input.return_by, custody_id: custody.custody_id },
  }, {
    custodyEffects: [{ custody: shipped.custody, eventType: 'shipped', occurredAt: shipped.event.occurred_at }],
  });
}

// --- 8–10. vendor resolution --------------------------------------------------------------------------

/** Bring the device back into the office after the vendor returns it. Advance-track cases never left, so there is nothing to receive. */
async function receiveBackIfWithVendor(
  trx: Knex.Transaction, tenant: string, actor: string, rma: IRmaCase,
  input: { location_id?: string | null; bin?: string | null; occurred_at?: string; note?: string | null; inbound_carrier?: string | null; inbound_tracking_number?: string | null }
): Promise<WarrantyCustodyEffect[]> {
  const custody = await loadOpenCustody(trx, tenant, rma);
  if (!custody || custody.state !== 'with_vendor') return [];
  if (!input.location_id) {
    throw new WarrantyError('location_required', 'Choose where the device is now, so it can be received back into the office.');
  }
  const note = [input.inbound_carrier && `${input.inbound_carrier} ${input.inbound_tracking_number ?? ''}`.trim(), `RMA ${rma.rma_number}`, input.note]
    .filter(Boolean).join(' · ');
  const received = await recordCustodyEvent(trx, tenant, actor, custody.custody_id, {
    event_type: 'received',
    location_id: input.location_id,
    bin: input.bin ?? null,
    holder_user_id: actor,
    occurred_at: input.occurred_at,
    note,
    document_ids: [],
  });
  return [{ custody: received.custody, eventType: 'received', occurredAt: received.event.occurred_at }];
}

export async function receiveVendorReplacementCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: ReceiveVendorReplacementInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'receive_replacement');
  if (!rma.asset_id) throw new WarrantyError('not_found', 'Asset not found.');
  const custodyEffects = await receiveBackIfWithVendor(trx, tenant, actor, rma, input);
  const replaced = await applyWarrantyReplacement(trx, tenant, {
    assetId: rma.asset_id,
    serialNumber: input.replacement_serial_number,
    model: input.model,
    manufacturer: input.manufacturer,
    warrantyEndDate: input.warranty_end_date,
    rmaId: rma.rma_id,
    rmaNumber: rma.rma_number,
    actorUserId: actor,
  });
  const at = input.occurred_at ?? new Date().toISOString();
  return conclude(trx, tenant, actor, rma, 'receive_replacement', {
    inbound_carrier: input.inbound_carrier,
    inbound_tracking_number: input.inbound_tracking_number,
    inbound_received_at: at,
    replacement_serial_number: input.replacement_serial_number,
    replacement_received_at: at,
  }, {
    occurredAt: at, carrier: input.inbound_carrier, trackingNumber: input.inbound_tracking_number, note: input.note,
    payload: { before: replaced.before, after: replaced.after },
  }, {
    custodyEffects,
    assetEffect: { assetId: rma.asset_id, before: replaced.before, after: replaced.after, changedPaths: replaced.changedPaths },
    serialNumber: input.replacement_serial_number,
  });
}

export async function recordVendorRepairCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: RecordVendorRepairInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'record_repair');
  const custodyEffects = await receiveBackIfWithVendor(trx, tenant, actor, rma, input);
  const at = input.occurred_at ?? new Date().toISOString();
  return conclude(trx, tenant, actor, rma, 'record_repair', {
    inbound_carrier: input.inbound_carrier,
    inbound_tracking_number: input.inbound_tracking_number,
    inbound_received_at: at,
  }, { occurredAt: at, carrier: input.inbound_carrier, trackingNumber: input.inbound_tracking_number, note: input.note }, { custodyEffects });
}

// --- 11. credit -----------------------------------------------------------------------------------------

export async function recordVendorCreditCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: RecordVendorCreditInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'record_credit');
  const custody = await loadOpenCustody(trx, tenant, rma);
  const custodyEffects: WarrantyCustodyEffect[] = [];
  if (custody) {
    const closed = await closeCustodyEpisode(trx, tenant, actor, custody.custody_id, 'disposed', {
      note: input.note, rmaId: rma.rma_id, rmaNumber: rma.rma_number,
    });
    custodyEffects.push({ custody: closed.custody, eventType: 'disposed', occurredAt: closed.occurredAt });
  }
  return conclude(trx, tenant, actor, rma, 'record_credit', {}, {
    occurredAt: input.occurred_at, note: input.note, payload: { custody_closed: Boolean(custody) },
  }, { custodyEffects });
}

// --- 12. return to client ---------------------------------------------------------------------------------

export async function returnDeviceToClientCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: ReturnDeviceToClientInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'return_to_client');
  // The RMA and the episode close in one transaction: a case cannot end with the device still on our shelf.
  const custody = await loadOpenCustody(trx, tenant, rma);
  const custodyEffects: WarrantyCustodyEffect[] = [];
  let assetStatusChange: WarrantyCustodyEffect['assetStatusChange'] = null;
  if (custody) {
    const returned = await recordCustodyEvent(trx, tenant, actor, custody.custody_id, {
      event_type: 'returned',
      counterparty: input.counterparty,
      occurred_at: input.occurred_at,
      note: [`RMA ${rma.rma_number}`, input.note].filter(Boolean).join(' · '),
      document_ids: [],
    });
    assetStatusChange = returned.assetStatusChange;
    custodyEffects.push({ custody: returned.custody, eventType: 'returned', occurredAt: returned.event.occurred_at, assetStatusChange });
  }
  return conclude(trx, tenant, actor, rma, 'return_to_client', { closed_reason: 'resolved' }, {
    occurredAt: input.occurred_at, note: input.note, payload: { custody_closed: Boolean(custody) },
  }, { custodyEffects });
}

// --- 13/14. close -------------------------------------------------------------------------------------------

/** Generic close for resolved-but-open warranty cases. `warranty_review` is refused by the state machine. */
export async function closeWarrantyRmaCore(
  trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: CloseWarrantyRmaInput, options: WarrantyCoreOptions = {}
): Promise<WarrantyTransitionResult> {
  const rma = await lockWarrantyRma(trx, tenant, rmaId, options);
  guard(rma, 'close');
  const reason = input.reason ?? (rma.status === 'credited' ? 'vendor_credited' : 'resolved');
  return conclude(trx, tenant, actor, rma, 'close', { closed_reason: rma.closed_reason ?? reason }, {
    occurredAt: input.occurred_at, note: input.note, payload: { closed_reason: reason },
  });
}


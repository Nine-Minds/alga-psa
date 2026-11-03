import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON } from '@alga-psa/billing/services/prepaidBlockLifecycleService';
import { BillingEngine } from '@alga-psa/billing/lib/billing/billingEngine';
import { persistInvoiceCharges } from '@alga-psa/billing/services/invoiceService';
import { syncPrepaidBlockIssuancesForContractLine } from '@alga-psa/billing/services/prepaidBlockIssuanceSync';
import { fetchPrepaidBlockIssuanceDueWorkRows } from '@alga-psa/billing/lib/prepaidBlockDueWork';
import { handlePrepaidBlockUsageChanged } from 'server/src/lib/eventBus/subscribers/prepaidBalanceAlertSubscriber';
import { EventSchemas } from '@alga-psa/event-schemas';
import { buildPrepaidBlockUsageChangedPayload } from '@alga-psa/scheduling/lib/timeEntryWriteCore';
import { expiredHourBlocksHandler } from '@alga-psa/jobs/handlers/expiredHourBlocksHandler';
import { expiringHourBlocksNotificationHandler } from '@alga-psa/jobs/handlers/expiringHourBlocksNotificationHandler';
import { applyPrepaidCoverage } from '@alga-psa/billing/lib/billing/chargeResolution/prepaidBlockRules';

// Acceptance test: Ryan's scenario (plan section 9, steps 1-6) end to end on a
// real database. A 40 h Prepaid Block of Remote Support sold at 4,400.00 with a
// 12 month expiry, exhaustion follow-on and expiry re-issue. Contract-end
// forfeiture is out of scope (captain decision 2).
//
// Time travel is simulated by moving the block's expiration_date and its expiry
// issuance due_date; "what bills hourly" is read from the engine's real hourly
// obligation loader (loadTimeBasedObligation), which is exactly the set of
// minutes the arrears invoice prices. Run with HOUR_BLOCK_DB_TESTS=1 (see
// prepaidBlockInvoicing.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;

const { publishEventMock } = vi.hoisted(() => ({ publishEventMock: vi.fn(async (_event: any) => undefined) }));

vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
    getSession: vi.fn(async () => ({ user: { id: userId } })),
  };
});
vi.mock('@alga-psa/auth/withAuth', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth/withAuth');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
  };
});
vi.mock('@alga-psa/auth/rbac', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth/rbac');
  return { ...actual, hasPermission: vi.fn(async () => true) };
});
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant })),
    getConnection: vi.fn(async () => db),
    runWithTenant: vi.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
  };
});
vi.mock('@alga-psa/core', async () => {
  const actual = await vi.importActual<any>('@alga-psa/core');
  return { ...actual, enqueueImmediateJob: vi.fn(async () => undefined) };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: vi.fn(async () => undefined),
  enqueueInvoiceVoid: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => false),
}));
vi.mock('@alga-psa/billing/services/autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined),
  startInvoiceAutopay: vi.fn(async () => undefined),
}));

const WINDOW = { startDate: '2026-03-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' };
const TIMING = {
  servicePeriodRecordId: null, duePosition: 'arrears' as const,
  servicePeriodStart: '2026-03-01', servicePeriodEnd: '2026-03-31',
  servicePeriodStartExclusive: '2026-03-01T00:00:00Z', servicePeriodEndExclusive: '2026-04-01T00:00:00Z',
  coverageRatio: 1,
};

interface World {
  clientId: string;
  ticketId: string;
  remoteServiceId: string;
  onsiteServiceId: string;
  contractId: string;
  blockLineId: string;
  otherLineId: string;
  clientContractId: string;
  cycleId: string;
  profileId: string;
}

async function setup(opts: { tier?: 'draft' | 'auto_issue' } = {}): Promise<World> {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  userId = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const remoteServiceId = uuidv4();
  const onsiteServiceId = uuidv4();
  const ticketId = uuidv4();
  const contractId = uuidv4();
  const blockLineId = uuidv4();
  const otherLineId = uuidv4();
  const clientContractId = uuidv4();
  const cycleId = uuidv4();
  const profileId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBA Tenant', email: 'pba@test.local', billing_source: 'test' });
  await db('tenant_settings').insert({ tenant, settings: {} });
  await db('default_billing_settings').insert({
    tenant, credit_expiration_notification_days: [7], zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: true,
  });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBA Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBA Type', is_active: true, order_number: 1 });
  for (const [serviceId, name, rate] of [[remoteServiceId, 'Remote Support', 11000], [onsiteServiceId, 'Onsite Consulting', 15000]] as const) {
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: name, custom_service_type_id: typeId,
      billing_method: 'hourly', default_rate: rate, unit_of_measure: 'hour',
      category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    // The contract bills in EUR, so the hourly rate must exist as an EUR catalog price.
    await db('service_prices').insert({ tenant, service_id: serviceId, currency_code: 'EUR', rate, effective_date: '2020-01-01' });
  }
  await db('users').insert({
    user_id: userId, tenant, username: `pba_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pba_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'A',
  });
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'PBA', ticket_number: `PBA-${ticketId.slice(0, 8)}` });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Gold Support', currency_code: 'EUR', status: 'active', is_active: true });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: '2026-03-01', is_active: true,
  });
  // Step 1: the Prepaid Block line (Hourly + overlay) and a plain Hourly line for other services.
  await db('contract_lines').insert([
    { tenant, contract_line_id: blockLineId, contract_id: contractId, contract_line_name: 'Remote Support Block', contract_line_type: 'Hourly', created_at: '2026-01-01T00:00:00Z' },
    { tenant, contract_line_id: otherLineId, contract_id: contractId, contract_line_name: 'Other Hourly', contract_line_type: 'Hourly', created_at: '2026-01-01T00:00:00Z' },
  ]);
  await db('contract_line_services').insert([
    { tenant, contract_line_id: blockLineId, service_id: remoteServiceId },
    { tenant, contract_line_id: otherLineId, service_id: onsiteServiceId },
  ]);
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: blockLineId, block_minutes: 2400, block_price: 440000, expiry_months: 12,
    trigger_on_exhaustion: true, trigger_on_expiry: true, replenishment_tier: opts.tier ?? 'draft',
    sold_as_service_id: remoteServiceId,
  });
  await db('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'PBA Profile', is_default: true });
  await db('client_billing_cycles').insert({
    tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly',
    period_start_date: '2026-03-01', period_end_date: '2026-04-01', effective_date: '2026-03-01',
  });
  return { clientId, ticketId, remoteServiceId, onsiteServiceId, contractId, blockLineId, otherLineId, clientContractId, cycleId, profileId };
}

afterEach(async () => {
  if (!db) return;
  publishEventMock.mockClear();
  await db('role_permissions').where({ tenant }).delete();
  await db('permissions').where({ tenant }).delete();
  for (const table of [
    'notifications', 'prepaid_balance_alert_deliveries', 'prepaid_balance_alerts', 'hour_block_time_allocations', 'hour_block_audit',
    'hour_block_service_scopes', 'hour_blocks', 'contract_line_block_issuances', 'recurring_service_periods', 'transactions',
    'invoice_time_entries', 'invoice_charge_details', 'invoice_charges', 'invoices', 'client_billing_cycles', 'client_tax_rates', 'client_tax_settings', 'tax_rates', 'tax_regions', 'time_entries', 'tickets',
    'contract_line_prepaid_blocks', 'contract_line_services', 'client_billing_profiles', 'contract_lines', 'client_contracts',
    'contracts', 'service_prices', 'service_catalog', 'service_types', 'users', 'clients', 'next_number', 'tenant_settings',
    'default_billing_settings', 'client_billing_settings', 'tenants',
  ]) {
    if (await db.schema.hasTable(table)) await db(table).where({ tenant }).delete();
  }
  await db.destroy();
});

// ---------------------------------------------------------------- helpers

const today = () => toCalendarDateStringInTimeZone(new Date(), 'UTC');
const shiftDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

let hourCursor = 0;

/** PREPAID_BLOCK_USAGE_CHANGED as the event bus delivers it to the subscriber (after the save commits). */
async function publishUsageChanged(tenantId: string, clientId: string, contractLineId: string) {
  const now = new Date().toISOString();
  // The payload is what the time-entry save publishes, and it must pass the bus's schema.
  const event = {
    id: uuidv4(), eventType: 'PREPAID_BLOCK_USAGE_CHANGED' as const, timestamp: now,
    payload: buildPrepaidBlockUsageChangedPayload(tenantId, { clientId, contractLineId }),
  };
  EventSchemas.PREPAID_BLOCK_USAGE_CHANGED.parse(event);
  await handlePrepaidBlockUsageChanged(event);
}

/** Logs time like the save hook: insert the entry, burn blocks, publish the usage event after commit. */
async function logTime(w: World, serviceId: string, lineId: string, minutes: number): Promise<string> {
  const entryId = uuidv4();
  const start = new Date(Date.UTC(2026, 2, 10, 0, 0, 0) + hourCursor * 3600000);
  hourCursor += Math.ceil(minutes / 60) + 1;
  const end = new Date(start.getTime() + minutes * 60000);
  await db('time_entries').insert({
    entry_id: entryId, tenant, user_id: userId, service_id: serviceId,
    work_item_id: w.ticketId, work_item_type: 'ticket',
    start_time: start.toISOString(), end_time: end.toISOString(),
    work_date: '2026-03-10', work_timezone: 'UTC', billable_duration: minutes,
    approval_status: 'APPROVED', invoiced: false, contract_line_id: lineId,
  });
  const { allocateTimeEntryDetailed } = await import('@alga-psa/shared/billingClients/hourBlockService');
  let usage: { clientId: string; contractLineId: string } | undefined;
  await db.transaction(async (trx) => {
    const { target, allocations } = await allocateTimeEntryDetailed(trx, tenant, w.clientId, {
      entry_id: entryId, service_id: serviceId, billable_duration: minutes, contract_line_id: lineId,
      work_item_id: w.ticketId, work_item_type: 'ticket', work_date: '2026-03-10', start_time: start.toISOString(),
    } as any);
    if (allocations.length > 0 && target?.kind === 'contract') {
      usage = { clientId: w.clientId, contractLineId: target.contractLineId };
    }
  });
  if (usage) {
    // PREPAID_BLOCK_USAGE_CHANGED, delivered to the subscriber after commit.
    await publishUsageChanged(tenant, usage.clientId, usage.contractLineId);
  }
  return entryId;
}

function clientContractLine(w: World, lineId: string) {
  return {
    client_contract_line_id: lineId, contract_line_id: lineId, client_contract_id: w.clientContractId,
    contract_id: w.contractId, contract_name: 'Gold Support', currency_code: 'EUR', is_active: true,
    start_date: '2026-03-01', end_date: null, client_id: w.clientId,
  };
}

interface BilledEntry { entry_id: string; billable_duration: number; rate: number; total: number }

/** The time charges the arrears invoice would carry for a line: the engine's real hourly obligation, priced. */
async function billedHourly(w: World, lineId: string): Promise<BilledEntry[]> {
  const engine = BillingEngine.forTransaction(db as any, tenant);
  const sink = { obligations: [] as any[], taxContexts: {} };
  const period = { tenant, ...WINDOW };
  await (engine as any).loadTimeBasedObligation(
    w.clientId, period, clientContractLine(w, lineId), undefined, TIMING, 'persisted',
    undefined, undefined, sink,
  );
  // The loader no longer applies block coverage: the charge resolver does,
  // from the engine's coverage rows, with the one shared rule.
  for (const obligation of sink.obligations) {
    const rows = await (engine as any).loadPrepaidCoverageRows(
      lineId,
      obligation.facts.activity.map((e: any) => e.sourceId),
    );
    obligation.facts.activity = applyPrepaidCoverage(obligation.facts.activity, rows);
  }
  const charges: any[] = (engine as any).calculateLoadedContractObligations(sink, w.clientId, period, 'EUR');
  return charges.filter((c) => c.type === 'time').map((c) => ({
    entry_id: c.entryId, billable_duration: Math.round(Number(c.duration) * 60), rate: Number(c.rate), total: Number(c.total),
  }));
}

/**
 * The whole-scenario accounting invariant: every logged minute is exactly one of
 * covered by an active/expired block, billed hourly on its line, or (transiently)
 * held on a pending block. Nothing is lost and nothing counts twice.
 */
async function assertPartition(w: World, opts: { expectHeld?: number } = {}) {
  const entries = await db('time_entries').where({ tenant });
  const billed = new Map<string, number>();
  for (const lineId of [w.blockLineId, w.otherLineId]) {
    for (const e of await billedHourly(w, lineId)) {
      expect(billed.has(e.entry_id), `entry ${e.entry_id} billed by more than one line`).toBe(false);
      billed.set(e.entry_id, e.billable_duration);
    }
  }
  const allocations = await db('hour_block_time_allocations as a')
    .join('hour_blocks as b', function () { this.on('a.block_id', 'b.block_id').andOn('a.tenant', 'b.tenant'); })
    .where('a.tenant', tenant).select('a.time_entry_id', 'a.minutes', 'b.status');
  let held = 0;
  for (const entry of entries) {
    const rows = allocations.filter((a) => a.time_entry_id === entry.entry_id);
    const covered = rows.filter((a) => a.status === 'active' || a.status === 'expired').reduce((s, a) => s + Number(a.minutes), 0);
    const isHeld = rows.some((a) => a.status === 'pending');
    const price = billed.get(entry.entry_id) ?? 0;
    if (isHeld) {
      held += Number(entry.billable_duration);
      expect(price, `held entry ${entry.entry_id} must not bill`).toBe(0);
    } else {
      expect(covered + price, `entry ${entry.entry_id} covered + billed`).toBe(Number(entry.billable_duration));
    }
  }
  expect(held).toBe(opts.expectHeld ?? 0);
  // Block ledger conservation: remaining = total - allocated, for every block.
  for (const block of await db('hour_blocks').where({ tenant }).whereIn('status', ['active', 'pending'])) {
    const drawn = allocations.length === 0 ? 0 : (await db('hour_block_time_allocations').where({ tenant, block_id: block.block_id }).sum({ m: 'minutes' }).first() as any).m;
    expect(block.total_minutes - Number(drawn ?? 0)).toBe(block.remaining_minutes);
  }
}

/** The Invoices screen's default view: `to` = the as-of day. Block rows never depend on cycle rows. */
async function dueWorkRows(_w: World, _period: unknown, asOf: string) {
  return fetchPrepaidBlockIssuanceDueWorkRows(db, { tenant, asOf, options: { dateRange: { to: asOf } } });
}

async function generateAndMaybeFinalize(w: World, issuanceId: string, invoiceDate: string, finalizeIt: boolean) {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: w.clientId, invoice_number: `PBA-${invoiceId.slice(0, 6)}`,
    invoice_date: invoiceDate, due_date: invoiceDate, total_amount: 0, subtotal: 0, tax: 0, status: 'draft',
    is_manual: false, is_prepayment: false, credit_applied: 0, currency_code: 'EUR',
  });
  await db.transaction(async (trx) => {
    const engine = BillingEngine.forTransaction(trx, tenant);
    const charges = await (engine as any).loadPrepaidBlockIssuanceCharges(w.clientId, WINDOW, [issuanceId]);
    const subtotal = await persistInvoiceCharges(
      trx, invoiceId, charges, { client_id: w.clientId, tax_region: null },
      { user: { id: userId } } as any, tenant, { requireRecurringServicePeriodLinkage: false },
    );
    await trx('invoices').where({ tenant, invoice_id: invoiceId }).update({ subtotal, total_amount: subtotal });
  });
  if (finalizeIt) {
    const { finalizeInvoiceWithKnex } = await import('@alga-psa/billing/actions/invoiceModification');
    await finalizeInvoiceWithKnex(invoiceId, db, tenant, userId, { skipAutoApply: true });
  }
  const block = await db('hour_blocks').where({ tenant, source_invoice_id: invoiceId }).first();
  return { invoiceId, blockId: block.block_id as string };
}

/** Steps 1 and 2: configure, due-work row at the start date, generate + finalize leaves 40 h active. */
async function startContractAndIssueFirstBlock(w: World) {
  await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.blockLineId));
  const issuance = await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.blockLineId }).first();
  expect(issuance).toMatchObject({ trigger_kind: 'contract_start', status: 'scheduled' });
  expect(dateOnly(issuance.due_date)).toBe('2026-03-01');

  const rows = await dueWorkRows(w, { start: '2026-03-01', end: '2026-04-01', cycleId: w.cycleId }, '2026-03-01');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ chargeType: 'PrepaidBlock', amountCents: 440000, blockTriggerKind: 'contract_start', clientId: w.clientId });
  expect(rows[0].blockDueDate).toBe('2026-03-01');

  const first = await generateAndMaybeFinalize(w, issuance.issuance_id, '2026-03-01', true);
  const block = await db('hour_blocks').where({ tenant, block_id: first.blockId }).first();
  expect(block).toMatchObject({ status: 'active', total_minutes: 2400, remaining_minutes: 2400, currency_code: 'EUR', contract_line_id: w.blockLineId });
  expect(Number(block.purchase_amount)).toBe(440000);
  expect(dateOnly(block.expiration_date)).toBe('2027-02-28');
  return first;
}

const alerts = () => db('prepaid_balance_alerts').where({ tenant, alert_type: 'prepaid_block' });
const pendingBlocks = () => db('hour_blocks').where({ tenant, status: 'pending' });

/** Steps 3 and 4 up to (and including) the follow-on draft. Returns the overflow entry and the follow-on. */
async function logToExhaustionAndDraftFollowOn(w: World, firstBlockId: string) {
  // Step 3: 38 h logged; 2 h remain and nothing bills hourly.
  await logTime(w, w.remoteServiceId, w.blockLineId, 20 * 60);
  await logTime(w, w.remoteServiceId, w.blockLineId, 18 * 60);
  expect((await db('hour_blocks').where({ tenant, block_id: firstBlockId }).first()).remaining_minutes).toBe(120);
  expect(await billedHourly(w, w.blockLineId)).toEqual([]);
  expect(await alerts()).toHaveLength(0);
  expect(await pendingBlocks()).toHaveLength(0);
  await assertPartition(w);

  // Step 4: +5 h. 2 h draw the block, 3 h are left over; the usage event drafts the follow-on.
  const overflow = await logTime(w, w.remoteServiceId, w.blockLineId, 5 * 60);
  expect((await db('hour_blocks').where({ tenant, block_id: firstBlockId }).first()).remaining_minutes).toBe(0);

  const [alert] = await alerts();
  expect(alert).toMatchObject({ hour_block_id: firstBlockId, contract_line_id: w.blockLineId });
  const pending = await pendingBlocks();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ contract_line_id: w.blockLineId, total_minutes: 2400, currency_code: 'EUR' });
  const followOnInvoice = await db('invoices').where({ tenant, invoice_id: pending[0].source_invoice_id }).first();
  expect(followOnInvoice).toMatchObject({ status: 'draft', currency_code: 'EUR' });
  expect(Number(followOnInvoice.total_amount)).toBe(440000);

  // 3 h sit on the pending block (the entry is held: 2 h active + 3 h pending, nothing bills).
  const onPending = await db('hour_block_time_allocations').where({ tenant, block_id: pending[0].block_id });
  expect(onPending.reduce((s, a) => s + Number(a.minutes), 0)).toBe(180);
  expect(pending[0].remaining_minutes).toBe(2400 - 180);
  expect(await billedHourly(w, w.blockLineId)).toEqual([]);
  await assertPartition(w, { expectHeld: 300 });

  // Drafted exactly once: more usage events and a replay of the event are no-ops.
  await publishUsageChanged(tenant, w.clientId, w.blockLineId);
  expect(await alerts()).toHaveLength(1);
  expect(await pendingBlocks()).toHaveLength(1);
  expect(await db('invoices').where({ tenant, invoice_id: followOnInvoice.invoice_id })).toHaveLength(1);
  expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'exhaustion' })).toHaveLength(1);

  return { overflow, followOn: pending[0], followOnInvoiceId: followOnInvoice.invoice_id as string };
}

// ------------------------------------------------------------------- tests

describe.runIf(enabled)('Prepaid Block acceptance: Ryan\'s scenario', () => {
  it('steps 1-6: finalize keeps 37 h on the follow-on, anniversary forfeits 10 h and re-issues, uncovered service bills on the other line', async () => {
    const w = await setup();
    const first = await startContractAndIssueFirstBlock(w);
    const { overflow, followOn, followOnInvoiceId } = await logToExhaustionAndDraftFollowOn(w, first.blockId);

    // Finalize the follow-on: the block activates at finalize with 37 h left (3 h already drawn).
    const { finalizeInvoiceWithKnex } = await import('@alga-psa/billing/actions/invoiceModification');
    await finalizeInvoiceWithKnex(followOnInvoiceId, db, tenant, userId, { skipAutoApply: true });
    const activated = await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).first();
    expect(activated).toMatchObject({ status: 'active', total_minutes: 2400, remaining_minutes: 2220 });
    // The held entry is fully covered now: nothing bills hourly for the 3 h.
    expect(await billedHourly(w, w.blockLineId)).toEqual([]);
    const overflowAllocations = await db('hour_block_time_allocations').where({ tenant, time_entry_id: overflow });
    expect(overflowAllocations.map((a) => Number(a.minutes)).sort((a, b) => a - b)).toEqual([120, 180]);
    await assertPartition(w);
    // The older block's scheduled expiry issuance is superseded by the newer block's.
    const openExpiry = await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', status: 'scheduled' });
    expect(openExpiry).toHaveLength(1);
    expect(openExpiry[0].source_block_id).toBe(followOn.block_id);

    // The panel's balance is the block being drawn (37 of 40 h), not the drained first block added to it.
    const { getContractLinePrepaidBlockSummary } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    expect(await getContractLinePrepaidBlockSummary(w.blockLineId)).toMatchObject({
      balance: { total_minutes: 2400, remaining_minutes: 2220, active_block_count: 1 },
    });

    // Step 5: 27 h more leaves 10 h unused at the anniversary.
    await logTime(w, w.remoteServiceId, w.blockLineId, 27 * 60);
    expect((await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).first()).remaining_minutes).toBe(600);
    await assertPartition(w);

    // Notice ahead: the expiring-soon notification lists the contract block.
    await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).update({ expiration_date: shiftDays(7) });
    await expiringHourBlocksNotificationHandler({ tenantId: tenant });
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const notified = publishEventMock.mock.calls[0][0].payload.blocks.find((b: any) => b.blockId === followOn.block_id);
    expect(notified).toMatchObject({ remainingMinutes: 600, contractName: 'Gold Support' });

    // The anniversary arrives: expiration passed, its expiry issuance is due.
    await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).update({ expiration_date: shiftDays(-1) });
    await db('contract_line_block_issuances').where({ tenant, issuance_id: openExpiry[0].issuance_id }).update({ due_date: today() });
    await expiredHourBlocksHandler({ tenantId: tenant });

    const expired = await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).first();
    expect(expired.status).toBe('expired');
    const audit = await db('hour_block_audit').where({ tenant, block_id: followOn.block_id, type: 'auto_expiration' });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata.remaining_minutes_at_expiration).toBe(600);
    // Forfeiture only drops the unused 10 h; the 27 h + 3 h already drawn stay covered.
    await assertPartition(w);

    // A new $4,400 issuance row is due (in the cycle containing today).
    // No client_billing_cycles row exists for the current month: the row must not depend on one.
    const dueRows = await dueWorkRows(w, null, today());
    expect(dueRows).toHaveLength(1);
    expect(dueRows[0]).toMatchObject({ chargeType: 'PrepaidBlock', amountCents: 440000, blockTriggerKind: 'expiry' });

    // Step 6: time on a service the block does not cover bills through the contract's other line.
    const onsite = await logTime(w, w.onsiteServiceId, w.otherLineId, 90);
    expect(await db('hour_block_time_allocations').where({ tenant, time_entry_id: onsite })).toHaveLength(0);
    const otherBilled = await billedHourly(w, w.otherLineId);
    expect(otherBilled).toHaveLength(1);
    expect(otherBilled[0]).toMatchObject({ entry_id: onsite, billable_duration: 90 });
    expect(await billedHourly(w, w.blockLineId)).toEqual([]);
    await assertPartition(w);
  });

  it('step 4 variant: the follow-on is discarded instead, so the 3 h bill at the hourly rate on the arrears invoice', async () => {
    const w = await setup();
    const first = await startContractAndIssueFirstBlock(w);
    const { overflow, followOn, followOnInvoiceId } = await logToExhaustionAndDraftFollowOn(w, first.blockId);

    // While the follow-on draft exists it replaces the source block's expiry issuance.
    const sourceExpiry = () => db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', source_block_id: first.blockId }).first();
    expect((await sourceExpiry()).status).toBe('superseded');

    const { hardDeleteInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    expect(await hardDeleteInvoice(followOnInvoiceId)).toEqual({ success: true });
    // Discarding the draft puts the source block's anniversary forfeiture back on the schedule.
    expect(await sourceExpiry()).toMatchObject({ status: 'scheduled', cancel_reason: null });
    expect((await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).first()).status).toBe('voided');

    // The 3 h that were held now bill as overage at 110.00; the 2 h stay covered.
    const billed = await billedHourly(w, w.blockLineId);
    expect(billed).toHaveLength(1);
    expect(billed[0]).toMatchObject({ entry_id: overflow, billable_duration: 180 });
    expect(billed[0]).toMatchObject({ rate: 11000, total: 33000 });
    await assertPartition(w);

    // The discarded draft cancels its exhaustion issuance and re-arms the alert (no pending block is left behind),
    // so nothing stays held and the next usage event, not this deletion, decides about a new follow-on.
    expect(await pendingBlocks()).toHaveLength(0);
    expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'exhaustion', status: 'scheduled' })).toHaveLength(0);
    expect((await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'exhaustion' }).first()).status).toBe('cancelled');
    expect((await alerts())[0].replenishment_status).toBeNull();
  });

  it('void path: voiding the exhaustion follow-on\'s invoice restores the source block\'s expiry issuance to scheduled', async () => {
    const w = await setup();
    const first = await startContractAndIssueFirstBlock(w);
    const { followOn, followOnInvoiceId } = await logToExhaustionAndDraftFollowOn(w, first.blockId);

    const sourceExpiry = () => db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', source_block_id: first.blockId }).first();
    expect((await sourceExpiry()).status).toBe('superseded');

    // The same service voidInvoice runs for the invoice's hour blocks (the draft's pending block is unused).
    const { voidHourBlocksForVoidedInvoice } = await import('@alga-psa/billing/services/prepaidBlockLifecycleService');
    const outcome = await db.transaction((trx) => voidHourBlocksForVoidedInvoice(
      trx, tenant, followOnInvoiceId, userId, new Date().toISOString(), 'test void',
    ));
    expect(outcome).toEqual({ ok: true });
    expect((await db('hour_blocks').where({ tenant, block_id: followOn.block_id }).first()).status).toBe('voided');
    expect(await sourceExpiry()).toMatchObject({ status: 'scheduled', cancel_reason: null });
  });
});

// ------------------------- deploy-fix: manual "Issue next block" over a scheduled expiry issuance

describe.runIf(enabled)('Prepaid Block: manual issue supersedes a scheduled expiry issuance (alga-2026-0002695)', () => {
  const sourceExpiry = (blockId: string) =>
    db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', source_block_id: blockId }).first();

  /** First block, 43 h logged, follow-on draft created then discarded, +1 h logged. Returns the source block + the 4 h entries. */
  async function stuckLine() {
    const w = await setup();
    const first = await startContractAndIssueFirstBlock(w);
    // Step 1: the finalized block has its expiry issuance scheduled.
    expect(await sourceExpiry(first.blockId)).toMatchObject({ status: 'scheduled' });
    const { overflow, followOn, followOnInvoiceId } = await logToExhaustionAndDraftFollowOn(w, first.blockId);
    // Step 2 asserted in the helper: 180 min held on the pending follow-on.
    expect(await sourceExpiry(first.blockId)).toMatchObject({ status: 'superseded', cancel_reason: EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON });

    // Step 3: discard the draft: allocations released, expiry issuance scheduled again, 3 h bill as overage.
    const { hardDeleteInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    expect(await hardDeleteInvoice(followOnInvoiceId)).toEqual({ success: true });
    expect(await db('hour_block_time_allocations').where({ tenant, block_id: followOn.block_id })).toHaveLength(0);
    expect(await sourceExpiry(first.blockId)).toMatchObject({ status: 'scheduled', cancel_reason: null });
    expect((await billedHourly(w, w.blockLineId)).map((b) => b.billable_duration)).toEqual([180]);

    // Step 4: 1 h more. The block is empty, the episode stays suppressed: nothing is drafted.
    const extra = await logTime(w, w.remoteServiceId, w.blockLineId, 60);
    expect(await pendingBlocks()).toHaveLength(0);
    expect((await sourceExpiry(first.blockId)).status).toBe('scheduled');
    expect(await alerts()).toHaveLength(1);
    return { w, first, overflow, extra };
  }

  const billedMinutes = async (w: World) => (await billedHourly(w, w.blockLineId)).reduce((s, b) => s + b.billable_duration, 0);

  it('steps 1-6: manual issue is allowed, supersedes the expiry issuance, and the 4 h are drawn from the new block exactly once', async () => {
    const { w, first, overflow, extra } = await stuckLine();
    expect(await billedMinutes(w)).toBe(240); // 3 h released + 1 h new, billed as overage while no block exists

    // Step 5: the action accepts and supersedes the expiry issuance with the usage reason.
    const { issueNextPrepaidBlock } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    const issued = await issueNextPrepaidBlock(w.blockLineId) as { issuanceId: string };
    expect(issued.issuanceId).toBeTruthy();
    expect(await sourceExpiry(first.blockId)).toMatchObject({ status: 'superseded', cancel_reason: EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON });
    const manual = await db('contract_line_block_issuances').where({ tenant, issuance_id: issued.issuanceId }).first();
    expect(manual).toMatchObject({ trigger_kind: 'manual', status: 'scheduled', source_block_id: first.blockId });
    // Exactly one scheduled issuance for the line.
    expect(await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.blockLineId, status: 'scheduled' })).toHaveLength(1);
    // A second click is rejected: now a manual issuance is scheduled.
    expect(await issueNextPrepaidBlock(w.blockLineId)).toMatchObject({ actionError: expect.stringContaining('already scheduled') });

    // Step 6: generate + finalize. 4 h drawn from the new block, none billed as overage.
    const manualBlock = await generateAndMaybeFinalize(w, issued.issuanceId, today(), true);
    const block = await db('hour_blocks').where({ tenant, block_id: manualBlock.blockId }).first();
    expect(block).toMatchObject({ status: 'active', total_minutes: 2400, remaining_minutes: 2160 }); // 36 h
    const drawn = await db('hour_block_time_allocations').where({ tenant, block_id: manualBlock.blockId });
    const byEntry = (id: string) => drawn.filter((a) => a.time_entry_id === id).reduce((sum, a) => sum + Number(a.minutes), 0);
    expect(byEntry(overflow)).toBe(180);
    expect(byEntry(extra)).toBe(60);
    expect(drawn.reduce((s, a) => s + Number(a.minutes), 0)).toBe(240);
    expect(await billedHourly(w, w.blockLineId)).toEqual([]);
    await assertPartition(w);
  });

  it('variant: voiding the manual draft restores the expiry issuance and the 4 h bill once as overage', async () => {
    const { w, first, overflow, extra } = await stuckLine();
    const { issueNextPrepaidBlock } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    const issued = await issueNextPrepaidBlock(w.blockLineId) as { issuanceId: string };
    const manualDraft = await generateAndMaybeFinalize(w, issued.issuanceId, today(), false);
    // While the manual draft exists the 4 h are held on its pending block, not billed.
    expect(await billedHourly(w, w.blockLineId)).toEqual([]);
    // (held counts whole entries: the 5 h overflow entry, 2 h of it drawn from the first block, plus the 1 h entry)
    await assertPartition(w, { expectHeld: 360 });
    expect((await sourceExpiry(first.blockId)).status).toBe('superseded');

    const invoice = await db('hour_blocks').where({ tenant, block_id: manualDraft.blockId }).first();
    const { hardDeleteInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    expect(await hardDeleteInvoice(invoice.source_invoice_id)).toEqual({ success: true });

    expect(await sourceExpiry(first.blockId)).toMatchObject({ status: 'scheduled', cancel_reason: null });
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: issued.issuanceId }).first()).status).toBe('cancelled');
    expect(await pendingBlocks()).toHaveLength(0);
    const billed = await billedHourly(w, w.blockLineId);
    expect(billed.map((b) => [b.entry_id, b.billable_duration]).sort()).toEqual([[extra, 60], [overflow, 180]].sort());
    await assertPartition(w);
    // Exactly one scheduled issuance, so "Issue next block" works again.
    expect(await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.blockLineId, status: 'scheduled' })).toHaveLength(1);
  });

  it('negative: while a block is pending (follow-on draft) or a usage issuance is scheduled, the action still rejects', async () => {
    const w = await setup();
    const first = await startContractAndIssueFirstBlock(w);
    await logToExhaustionAndDraftFollowOn(w, first.blockId);
    const { issueNextPrepaidBlock } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    expect(await issueNextPrepaidBlock(w.blockLineId)).toMatchObject({ actionError: expect.stringContaining('pending block') });
    expect(await pendingBlocks()).toHaveLength(1);
    expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'manual' })).toHaveLength(0);
  });
});

// ------------------------------------------------- deploy-fix: real generation path

describe.runIf(enabled)('Prepaid Block deploy fixes: generation through the real action path', () => {
  async function materialize(w: World) {
    const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
    for (const lineId of [w.blockLineId, w.otherLineId]) {
      await db.transaction((trx) => syncRecurringServicePeriodsForContractLine(trx, {
        tenant, contractLineId: lineId, sourceRunPrefix: 'pba-deploy-fix',
      }));
    }
  }

  async function logUnapprovedTime(w: World) {
    const entryId = uuidv4();
    await db('time_entries').insert({
      entry_id: entryId, tenant, user_id: userId, service_id: w.onsiteServiceId,
      work_item_id: w.ticketId, work_item_type: 'ticket',
      start_time: '2026-03-02T08:00:00Z', end_time: '2026-03-02T09:30:00Z',
      work_date: '2026-03-02', work_timezone: 'UTC', billable_duration: 90,
      approval_status: 'DRAFT', invoiced: false, contract_line_id: w.otherLineId,
    });
    return entryId;
  }

  async function prepareClientForGeneration(w: World) {
    await db('clients').where({ tenant, client_id: w.clientId }).update({ billing_email: 'billing@pba.test' });
    // Hourly lines bill T&M in arrears; that is what gives the window its recurring (T&M) due-work row.
    await db('contract_lines').where({ tenant, contract_id: w.contractId }).update({ billing_timing: 'arrears', cadence_owner: 'client' });
    await db('contracts').where({ tenant, contract_id: w.contractId }).update({ owner_client_id: w.clientId });
    // Generation needs a default tax region (0% keeps totals equal to the block price).
    const taxRateId = uuidv4();
    await db('tax_regions').insert({ tenant, region_code: 'PBA-R', region_name: 'PBA Region', is_active: true });
    await db('tax_rates').insert({ tenant, tax_rate_id: taxRateId, region_code: 'PBA-R', tax_percentage: 0, start_date: '2020-01-01' });
    await db('client_tax_rates').insert({ tenant, client_id: w.clientId, tax_rate_id: taxRateId, is_default: true });
  }

  it('generates the block invoice without claiming the cycle, despite unapproved time on another line, and the T&M invoice stays blocked until approval and is then generated exactly once', async () => {
    const w = await setup();
    await prepareClientForGeneration(w);
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.blockLineId));
    await materialize(w);
    const entryId = await logUnapprovedTime(w);
    // March work bills in arrears in the April window. Put the block's due date in that same window and give
    // the client its April cycle, so the block row and the T&M row compete for one window.
    await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'contract_start' }).update({ due_date: '2026-04-01' });
    const aprilCycleId = uuidv4();
    await db('client_billing_cycles').insert({
      tenant, billing_profile_id: w.profileId, billing_cycle_id: aprilCycleId, client_id: w.clientId, billing_cycle: 'monthly',
      period_start_date: '2026-04-01', period_end_date: '2026-05-01', effective_date: '2026-04-01',
    });

    // Default view (to = the as-of day): the block due at contract start is Ready.
    const [row] = await dueWorkRows(w, null, '2026-04-01');
    expect(row).toMatchObject({ chargeType: 'PrepaidBlock', billingCycleId: null, canGenerate: true, isEarly: false });

    // Approval gate: only the block row is selected -> not blocked by the other line's draft time.
    const { generateInvoiceForSelectionInput, generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
    const blockInvoice: any = await generateInvoiceForSelectionInput(row.selectorInput, {}, undefined);
    expect(blockInvoice?.error, JSON.stringify(blockInvoice)).toBeUndefined();
    const blockInvoiceRow = await db('invoices').where({ tenant, invoice_id: blockInvoice.invoiceId ?? blockInvoice.invoice_id }).first();
    expect(blockInvoiceRow.billing_cycle_id).toBeNull();
    expect(Number(blockInvoiceRow.total_amount)).toBe(440000);

    // The cycle is still uninvoiced, so the window's T&M (arrears) invoice is unaffected by the block invoice.
    // A selection that includes the T&M row is still blocked by the unapproved entry.
    const blocked: any = await generateInvoice(aprilCycleId, {});
    expect(blocked?.error ?? blocked?.message ?? JSON.stringify(blocked)).toMatch(/approv|TIME_APPROVAL_REQUIRED/i);
    expect(await db('invoices').where({ tenant, billing_cycle_id: aprilCycleId })).toHaveLength(0);

    await db('time_entries').where({ tenant, entry_id: entryId }).update({ approval_status: 'APPROVED' });
    const arrears: any = await generateInvoice(aprilCycleId, {});
    expect(arrears?.error, JSON.stringify(arrears)).toBeUndefined();
    expect(await db('invoices').where({ tenant, billing_cycle_id: aprilCycleId })).toHaveLength(1);
    // Exactly once: a second run for the same cycle is rejected as a duplicate, not re-invoiced.
    const again: any = await generateInvoice(aprilCycleId, {});
    expect(again?.error ?? again?.message ?? again).toBeTruthy();
    expect(await db('invoices').where({ tenant, billing_cycle_id: aprilCycleId })).toHaveLength(1);
    // The block was issued exactly once.
    expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'contract_start', status: 'invoiced' })).toHaveLength(1);
  });

  it('the server-side generate path rejects an issuance whose due date is in the future', async () => {
    const w = await setup();
    await prepareClientForGeneration(w);
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.blockLineId));
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const issuance = await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'contract_start' }).first();
    await db('contract_line_block_issuances').where({ tenant, issuance_id: issuance.issuance_id }).update({ due_date: future });
    const engine = BillingEngine.forTransaction(db as any, tenant);
    await expect((engine as any).loadPrepaidBlockIssuanceCharges(w.clientId, WINDOW, [issuance.issuance_id]))
      .rejects.toThrow(/not due until/);
    await db('contract_line_block_issuances').where({ tenant, issuance_id: issuance.issuance_id }).update({ due_date: today() });
    await expect((engine as any).loadPrepaidBlockIssuanceCharges(w.clientId, WINDOW, [issuance.issuance_id]))
      .resolves.toHaveLength(1);
  });

  it('after generate + finalize, "Issue next block" lists a row in the same window without creating a cycle', async () => {
    const w = await setup();
    await prepareClientForGeneration(w);
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.blockLineId));
    await materialize(w);
    const [row] = await dueWorkRows(w, null, '2026-03-01');
    const { generateInvoiceForSelectionInput } = await import('@alga-psa/billing/actions/invoiceGeneration');
    const invoice: any = await generateInvoiceForSelectionInput(row.selectorInput, {}, undefined);
    expect(invoice?.error, JSON.stringify(invoice)).toBeUndefined();
    const { finalizeInvoiceWithKnex } = await import('@alga-psa/billing/actions/invoiceModification');
    await finalizeInvoiceWithKnex((invoice.invoiceId ?? invoice.invoice_id), db, tenant, userId, { skipAutoApply: true });

    // The contract's own next (expiry) issuance is open; "Issue next block" is for a line with none scheduled.
    await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.blockLineId, status: 'scheduled' }).update({ status: 'cancelled' });
    const cyclesBefore = await db('client_billing_cycles').where({ tenant, client_id: w.clientId }).count({ n: '*' }).first() as any;
    const { issueNextPrepaidBlock } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    await issueNextPrepaidBlock(w.blockLineId);

    // Due today; the client has only the March cycle, so the window cannot come from a cycle row.
    const monthStart = `${today().slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const rows = await dueWorkRows(w, null, today());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chargeType: 'PrepaidBlock', blockTriggerKind: 'manual', billingCycleId: null,
      invoiceWindowStart: monthStart, invoiceWindowEnd: nextMonth, canGenerate: true, isEarly: false,
    });
    const cyclesAfter = await db('client_billing_cycles').where({ tenant, client_id: w.clientId }).count({ n: '*' }).first() as any;
    expect(cyclesAfter.n).toEqual(cyclesBefore.n);
  });
});

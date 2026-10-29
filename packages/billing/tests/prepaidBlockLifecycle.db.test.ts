import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { BillingEngine } from '../src/lib/billing/billingEngine';
import { persistInvoiceCharges } from '../src/services/invoiceService';
import { applyPrepaidCoverage } from '../src/lib/billing/chargeResolution/prepaidBlockRules';

// Guarded DB lifecycle tests for Prepaid Block contract blocks (plan sections 4
// and 9): finalize activation + expiry scheduling, replenishment-deferral
// exemption, unfinalize, draft delete and void. Run with HOUR_BLOCK_DB_TESTS=1
// (see prepaidBlockInvoicing.db.test.ts for the env vars).
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

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant })),
  };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('../src/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: vi.fn(async () => undefined),
  enqueueInvoiceVoid: vi.fn(async () => undefined),
}));
vi.mock('../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
}));
vi.mock('../src/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => false),
}));
vi.mock('../src/services/autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined),
  startInvoiceAutopay: vi.fn(async () => undefined),
}));

interface World {
  clientId: string;
  ticketId: string;
  serviceId: string;
  lineId: string;
  clientContractId: string;
  issuanceId: string;
}

let world: World | null = null;

async function setup(opts: { blockMinutes?: number; blockPrice?: number; triggerKind?: string } = {}): Promise<World> {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  userId = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const ticketId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const issuanceId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBL Tenant', email: 'pbl@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBL Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBL Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('users').insert({
    user_id: userId, tenant, username: `pbl_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pbl_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'L',
  });
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'PBL', ticket_number: `PBL-${ticketId.slice(0, 8)}` });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBL Contract', currency_code: 'EUR' });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: '2026-01-01', is_active: true,
  });
  await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBL Line' });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: opts.blockMinutes ?? 2400, block_price: opts.blockPrice ?? 440000,
    expiry_months: 12, trigger_on_expiry: true, sold_as_service_id: serviceId,
  });
  await db('contract_line_block_issuances').insert({
    tenant, issuance_id: issuanceId, contract_line_id: lineId, client_contract_id: clientContractId,
    client_id: clientId, trigger_kind: opts.triggerKind ?? 'contract_start', due_date: '2026-03-31', status: 'scheduled',
  });
  world = { clientId, ticketId, serviceId, lineId, clientContractId, issuanceId };
  return world;
}

afterEach(async () => {
  if (!db) return;
  for (const table of [
    'prepaid_balance_alerts', 'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'transactions', 'invoice_charges', 'invoices', 'time_entries', 'tickets',
    'contract_line_prepaid_blocks', 'contract_line_services', 'client_billing_profiles', 'contract_lines', 'client_contracts',
    'contracts', 'service_catalog', 'service_types', 'users', 'clients', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
  world = null;
});

async function insertEntry(w: World, minutes: number, hourOffset: number) {
  const entryId = uuidv4();
  const start = new Date(`2026-03-10T${String(8 + hourOffset).padStart(2, '0')}:00:00.000Z`);
  await db('time_entries').insert({
    entry_id: entryId, tenant, user_id: userId, service_id: w.serviceId,
    work_item_id: w.ticketId, work_item_type: 'ticket',
    start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
    work_date: '2026-03-10', work_timezone: 'UTC', billable_duration: minutes,
    approval_status: 'APPROVED', invoiced: false, contract_line_id: w.lineId,
  });
  return entryId;
}

async function makeInvoice(w: World, invoiceDate: string) {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: w.clientId, invoice_number: `PBL-${invoiceId.slice(0, 6)}`,
    invoice_date: invoiceDate, due_date: invoiceDate, total_amount: 0, subtotal: 0, tax: 0, status: 'draft',
    is_manual: false, is_prepayment: false, credit_applied: 0, currency_code: 'EUR',
  });
  return invoiceId;
}

/** Generates the block charge for the world's issuance onto a new draft invoice (pending block). */
async function generateDraft(w: World, invoiceDate = '2026-03-31') {
  const invoiceId = await makeInvoice(w, invoiceDate);
  await db.transaction(async (trx) => {
    const engine = BillingEngine.forTransaction(trx, tenant);
    const charges = await (engine as any).loadPrepaidBlockIssuanceCharges(
      w.clientId, { startDate: '2026-03-31T00:00:00Z', endDate: '2026-04-01T00:00:00Z' }, [w.issuanceId],
    );
    const subtotal = await persistInvoiceCharges(
      trx, invoiceId, charges, { client_id: w.clientId, tax_region: null },
      { user: { id: userId } } as any, tenant, { requireRecurringServicePeriodLinkage: false },
    );
    await trx('invoices').where({ tenant, invoice_id: invoiceId }).update({ subtotal, total_amount: subtotal });
  });
  const block = await db('hour_blocks').where({ tenant, source_invoice_id: invoiceId }).first();
  return { invoiceId, blockId: block.block_id as string };
}

async function finalize(invoiceId: string, options: Record<string, unknown> = {}) {
  const { finalizeInvoiceWithKnex } = await import('../src/actions/invoiceModification');
  await finalizeInvoiceWithKnex(invoiceId, db, tenant, userId, { skipAutoApply: true, ...options });
}

async function allocationsFor(entryId: string) {
  return db('hour_block_time_allocations').where({ tenant, time_entry_id: entryId });
}

describe.runIf(enabled)('Prepaid Block lifecycle: finalize', () => {
  it('activates at finalize, recomputes expiry from the final invoice date, uses the authoritative total, keeps gap draws, schedules the expiry issuance', async () => {
    // 3 h for 1000.01: quantity x unit_price (3 x 33334 = 100002) differs from the authoritative total (100001).
    const w = await setup({ blockMinutes: 180, blockPrice: 100001 });
    const gap = await insertEntry(w, 90, 0);
    const { invoiceId, blockId } = await generateDraft(w, '2026-03-31');
    expect((await allocationsFor(gap)).map((a) => [a.block_id, Number(a.minutes)])).toEqual([[blockId, 90]]);
    const pending = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
    expect(pending.remaining_minutes).toBe(90);

    // The draft's date is edited before finalize.
    await db('invoices').where({ tenant, invoice_id: invoiceId }).update({ invoice_date: '2026-04-15' });
    await finalize(invoiceId);

    const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
    expect(block.status).toBe('active');
    expect(Number(block.purchase_amount)).toBe(100001);
    expect(new Date(block.expiration_date).toISOString().slice(0, 10)).toBe('2027-04-14');
    expect(block.total_minutes).toBe(180);
    expect(block.remaining_minutes).toBe(90); // the gap draw survives activation
    expect((await allocationsFor(gap))).toHaveLength(1);

    const expiry = await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry' }).first();
    expect(expiry).toMatchObject({ status: 'scheduled', source_block_id: blockId, contract_line_id: w.lineId });
    expect(new Date(expiry.due_date).toISOString().slice(0, 10)).toBe('2027-04-15');
    expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase' })).toHaveLength(1);
  });

  it('a newer activated block supersedes the older scheduled expiry issuance; the helper also supersedes on demand', async () => {
    const w = await setup();
    const first = await generateDraft(w);
    await finalize(first.invoiceId);
    const firstExpiry = await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', status: 'scheduled' }).first();
    expect(firstExpiry.source_block_id).toBe(first.blockId);

    // Newer block B is issued while block A's expiry obligation is (again) the
    // open issuance: park it while B's issuance is generated, then restore it
    // so B's activation meets a still-scheduled older expiry.
    const manualId = uuidv4();
    await db('contract_line_block_issuances').where({ tenant, issuance_id: firstExpiry.issuance_id }).update({ status: 'cancelled' });
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: manualId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'manual', due_date: '2026-06-01', status: 'scheduled',
    });
    const second = await generateDraft({ ...w, issuanceId: manualId }, '2026-06-01');
    await db('contract_line_block_issuances').where({ tenant, issuance_id: firstExpiry.issuance_id }).update({ status: 'scheduled' });
    await finalize(second.invoiceId);

    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: firstExpiry.issuance_id }).first()).status).toBe('superseded');
    const scheduled = await db('contract_line_block_issuances').where({ tenant, status: 'scheduled' });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ trigger_kind: 'expiry', source_block_id: second.blockId });

    const { supersedeExpiryIssuancesForLine } = await import('../src/services/prepaidBlockLifecycleService');
    await db.transaction((trx) => supersedeExpiryIssuancesForLine(trx, tenant, w.lineId, { reason: 'config removed' }));
    expect(await db('contract_line_block_issuances').where({ tenant, status: 'scheduled' })).toHaveLength(0);
  });

  it('deferral exemption: only alert_type prepaid_block activates at finalize; a bucket alert still defers to payment', async () => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    const alertId = uuidv4();
    await db('prepaid_balance_alerts').insert({
      tenant, alert_id: alertId, client_id: w.clientId, alert_type: 'prepaid_block',
      dedupe_key: `prepaid_block:${w.lineId}:test`, replenishment_status: 'pending', replenishment_invoice_id: invoiceId,
      contract_line_id: w.lineId,
    });
    await finalize(invoiceId);
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('active');
    expect((await db('prepaid_balance_alerts').where({ tenant, alert_id: alertId }).first()).replenishment_status).toBe('issued');
    await db('prepaid_balance_alerts').where({ tenant }).delete();

    // Same shape of invoice, but the linked alert is a bucket alert: payment-gated as before.
    const w2 = await setup();
    const draft = await generateDraft(w2);
    await db('prepaid_balance_alerts').insert({
      tenant, alert_id: uuidv4(), client_id: w2.clientId, alert_type: 'bucket',
      dedupe_key: `bucket:${w2.lineId}:test`, replenishment_status: 'pending', replenishment_invoice_id: draft.invoiceId,
    });
    await finalize(draft.invoiceId);
    expect((await db('hour_blocks').where({ tenant, block_id: draft.blockId }).first()).status).toBe('pending');
    expect((await db('prepaid_balance_alerts').where({ tenant }).first()).replenishment_status).toBe('issued');
  });
});

describe.runIf(enabled)('Prepaid Block lifecycle: unfinalize', () => {
  it.each(['void', 'unfinalize'] as const)('%s of an unused expired block removes paid coverage', async (action) => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    await db('hour_blocks').where({ tenant, block_id: blockId }).update({ status: 'expired' });
    if (action === 'void') {
      const { voidInvoice } = await import('../src/actions/voidInvoiceActions');
      expect(await voidInvoice(invoiceId, 'test')).toEqual({ success: true });
    } else {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      expect(await unfinalizeInvoice(invoiceId)).toEqual({ success: true });
    }
    const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
    expect(block.status).toBe(action === 'void' ? 'voided' : 'pending');
    const entryId = await insertEntry(w, 60, 0);
    const { reconcileLineAllocations } = await import('@alga-psa/shared/billingClients/hourBlockService');
    await db.transaction((trx) => reconcileLineAllocations(trx, tenant, w.lineId));
    const allocations = await allocationsFor(entryId);
    if (action === 'void') {
      expect(allocations).toHaveLength(0);
    } else {
      expect(allocations).toHaveLength(1);
      // Pending draws are held by the shared coverage rule, not paid coverage.
      expect(applyPrepaidCoverage([{ sourceId: entryId, billableMinutes: 60 }], [{ entryId, blockStatus: block.status, minutes: 60 }])).toEqual([]);
    }
  });

  it.each(['void', 'unfinalize'] as const)('%s refuses an expired block already used by invoiced work', async (action) => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    const entryId = await insertEntry(w, 60, 0);
    const { reconcileLineAllocations } = await import('@alga-psa/shared/billingClients/hourBlockService');
    await db.transaction((trx) => reconcileLineAllocations(trx, tenant, w.lineId));
    await db('time_entries').where({ tenant, entry_id: entryId }).update({ invoiced: true });
    await db('hour_blocks').where({ tenant, block_id: blockId }).update({ status: 'expired' });
    const result: any = action === 'void'
      ? await (await import('../src/actions/voidInvoiceActions')).voidInvoice(invoiceId, 'test')
      : await (await import('../src/actions/invoiceModification')).unfinalizeInvoice(invoiceId);
    expect(action === 'void' ? result.error : result.actionError).toMatch(/already been used/);
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('expired');
    expect((await allocationsFor(entryId)).map((row) => [row.block_id, Number(row.minutes)])).toEqual([[blockId, 60]]);
    expect((await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).status).not.toBe('cancelled');
  });

  it.each(['void', 'unfinalize'] as const)('does not spend a legacy expired block whose invoice was %s', async (action) => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    await db('hour_blocks').where({ tenant, block_id: blockId }).update({ status: 'expired' });
    if (action === 'void') {
      expect(await (await import('../src/actions/voidInvoiceActions')).voidInvoice(invoiceId, 'test')).toEqual({ success: true });
    } else {
      expect(await (await import('../src/actions/invoiceModification')).unfinalizeInvoice(invoiceId)).toEqual({ success: true });
    }
    // Reproduce the stale state left by the previous reversal hooks.
    await db('hour_blocks').where({ tenant, block_id: blockId }).update({ status: 'expired' });
    const entryId = await insertEntry(w, 60, 0);
    const { reconcileLineAllocations } = await import('@alga-psa/shared/billingClients/hourBlockService');
    await db.transaction((trx) => reconcileLineAllocations(trx, tenant, w.lineId));
    expect(await allocationsFor(entryId)).toHaveLength(0);
  });

  it('unused active block returns to pending and its expiry issuance is superseded; used block refuses', async () => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');

    expect(await unfinalizeInvoice(invoiceId)).toEqual({ success: true });
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('pending');
    expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' })).toHaveLength(1);
    const expiry = await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry' }).first();
    expect(expiry.status).toBe('superseded');

    // Re-finalize, then use the block: unfinalize must refuse.
    await finalize(invoiceId);
    expect((await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', status: 'scheduled' }))).toHaveLength(1);
    const entry = await insertEntry(w, 60, 0);
    const { allocateTimeEntry } = await import('@alga-psa/shared/billingClients/hourBlockService');
    await db.transaction(async (trx) => {
      await allocateTimeEntry(trx, tenant, w.clientId, {
        entry_id: entry, service_id: w.serviceId, billable_duration: 60, contract_line_id: w.lineId,
        work_item_id: w.ticketId, work_item_type: 'ticket', work_date: '2026-03-10',
        start_time: '2026-03-10T08:00:00.000Z',
      } as any);
    });
    expect((await allocationsFor(entry))).toHaveLength(1);
    const refused = await unfinalizeInvoice(invoiceId);
    expect(refused).toHaveProperty('actionError');
    expect(refused).toHaveProperty('messageKey', 'msp/invoicing:errors.invoice.usedHourBlockUnfinalize');
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('active');
  });
});

describe.runIf(enabled)('Prepaid Block lifecycle: draft delete and void', () => {
  it('delete releases gap draws (allocation_release), minutes fall to overage, and a date issuance is re-due', async () => {
    const w = await setup();
    const gap = await insertEntry(w, 90, 0);
    const { invoiceId, blockId } = await generateDraft(w);
    expect(await allocationsFor(gap)).toHaveLength(1);

    const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
    expect(await hardDeleteInvoice(invoiceId)).toEqual({ success: true });

    const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
    expect(block.status).toBe('voided');
    expect(await allocationsFor(gap)).toHaveLength(0);
    const release = await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'allocation_release' }).first();
    expect(Number(release.minutes_delta)).toBe(90);
    expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'void' })).toHaveLength(1);

    const issuance = await db('contract_line_block_issuances').where({ tenant, issuance_id: w.issuanceId }).first();
    expect(issuance).toMatchObject({ status: 'scheduled', block_id: null, invoice_id: null, invoice_charge_id: null });

    // The released minutes are no longer held: the engine supplies no coverage
    // rows for the entry and the resolver prices it in full as overage.
    const engine = BillingEngine.forTransaction(db as any, tenant);
    const rows = await (engine as any).loadPrepaidCoverageRows(w.lineId, [gap]);
    expect(rows).toEqual([]);
    const priced = applyPrepaidCoverage([{ sourceId: gap, billableMinutes: 90 }], rows);
    expect(priced.map((e) => [e.sourceId, e.billableMinutes])).toEqual([[gap, 90]]);
  });

  it.each(['exhaustion', 'manual'])('delete cancels a %s issuance instead of re-dueing it', async (kind) => {
    const w = await setup({ triggerKind: kind });
    const { invoiceId } = await generateDraft(w);
    const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
    expect(await hardDeleteInvoice(invoiceId)).toEqual({ success: true });
    const issuance = await db('contract_line_block_issuances').where({ tenant, issuance_id: w.issuanceId }).first();
    expect(issuance.status).toBe('cancelled');
  });

  it('void: unused active contract block is voided and its issuance re-due; the gap draw frees', async () => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    const { voidInvoice } = await import('../src/actions/voidInvoiceActions');
    expect(await voidInvoice(invoiceId, 'test void')).toEqual({ success: true });

    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('voided');
    expect((await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).status).toBe('cancelled');
    const issuance = await db('contract_line_block_issuances').where({ tenant, issuance_id: w.issuanceId }).first();
    expect(issuance.status).toBe('scheduled');
    // The expiry issuance triggered by the voided block is superseded (and the re-due start issuance is the only open one).
    expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'expiry', status: 'scheduled' })).toHaveLength(0);
  });

  it('void: a pending (deferred) block holding a gap draw releases it so the minutes fall to overage; usage issuance cancelled, alert stays suppressed', async () => {
    const w = await setup({ triggerKind: 'exhaustion' });
    const gap = await insertEntry(w, 90, 0);
    const { invoiceId, blockId } = await generateDraft(w);
    const alertId = uuidv4();
    await db('prepaid_balance_alerts').insert({
      tenant, alert_id: alertId, client_id: w.clientId, alert_type: 'bucket',
      dedupe_key: `bucket:${w.lineId}:void`, replenishment_status: 'pending', replenishment_invoice_id: invoiceId,
    });
    await finalize(invoiceId); // bucket alert: deferred, the block stays pending
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('pending');
    expect(await allocationsFor(gap)).toHaveLength(1);

    const { voidInvoice } = await import('../src/actions/voidInvoiceActions');
    expect(await voidInvoice(invoiceId, 'test void')).toEqual({ success: true });
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('voided');
    expect(await allocationsFor(gap)).toHaveLength(0);
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: w.issuanceId }).first()).status).toBe('cancelled');
    const alert = await db('prepaid_balance_alerts').where({ tenant, alert_id: alertId }).first();
    expect(alert).toMatchObject({ replenishment_status: 'skipped', replenishment_invoice_id: invoiceId });
  });

  it('void refuses when the active contract block has been used; nothing is changed', async () => {
    const w = await setup();
    const { invoiceId, blockId } = await generateDraft(w);
    await finalize(invoiceId);
    const entry = await insertEntry(w, 60, 0);
    const { allocateTimeEntry } = await import('@alga-psa/shared/billingClients/hourBlockService');
    await db.transaction(async (trx) => {
      await allocateTimeEntry(trx, tenant, w.clientId, {
        entry_id: entry, service_id: w.serviceId, billable_duration: 60, contract_line_id: w.lineId,
        work_item_id: w.ticketId, work_item_type: 'ticket', work_date: '2026-03-10',
        start_time: '2026-03-10T08:00:00.000Z',
      } as any);
    });
    const { voidInvoice } = await import('../src/actions/voidInvoiceActions');
    const result: any = await voidInvoice(invoiceId, 'test void');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already been used/);
    expect((await db('hour_blocks').where({ tenant, block_id: blockId }).first()).status).toBe('active');
    expect((await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).status).not.toBe('cancelled');
  });
});

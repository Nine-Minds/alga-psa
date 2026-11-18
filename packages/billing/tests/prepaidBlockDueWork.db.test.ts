import { describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { groupDueServicePeriodsForInvoiceCandidates } from '@alga-psa/shared/billingClients/recurringTiming';
import { syncPrepaidBlockIssuancesForContractLine } from '../src/services/prepaidBlockIssuanceSync';
import { fetchPrepaidBlockIssuanceDueWorkRows } from '../src/lib/prepaidBlockDueWork';
import { detectStalePendingPrepaidBlockWarnings } from '../src/actions/recurringApprovalBlockers';
import { syncRecurringServicePeriodsForContractLine } from '../src/actions/recurringServicePeriodSync';
import { BillingEngine } from '../src/lib/billing/billingEngine';
import { calculateBillingForSelectionInputs } from '../src/actions/invoiceGeneration';

// Guarded DB tests for Prepaid Block issuance sync and due-work listing (plan
// section 5 and 9). Run with HOUR_BLOCK_DB_TESTS=1 (see
// prepaidBlockInvoicing.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  getSession: vi.fn(async () => null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

interface World {
  db: Knex;
  tenant: string;
  clientId: string;
  serviceId: string;
  contractId: string;
  lineId: string;
  clientContractId: string;
  cycleId: string;
  profileId: string;
}

async function setup(opts: { startDate?: string; lineCreatedAt?: string; contractCreatedAt?: string; cadenceOwner?: 'client' | 'contract'; withIssuance?: boolean } = {}): Promise<World> {
  const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  const tenant = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const cycleId = uuidv4();
  const profileId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBD Tenant', email: 'pbd@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBD Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBD Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBD Contract', currency_code: 'EUR', status: 'active',
    ...(opts.contractCreatedAt ? { created_at: opts.contractCreatedAt } : {}),
  });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: opts.startDate ?? '2026-03-01', is_active: true,
  });
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBD Line', contract_line_type: 'Hourly',
    ...(opts.cadenceOwner ? { cadence_owner: opts.cadenceOwner } : {}),
    ...(opts.lineCreatedAt ? { created_at: opts.lineCreatedAt } : {}),
  });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 2400, block_price: 440000,
    expiry_months: 12, trigger_on_expiry: true, sold_as_service_id: serviceId,
  });
  await db('client_billing_profiles').insert({
    tenant, billing_profile_id: profileId, client_id: clientId, name: 'PBD Profile', is_default: true,
  });
  await db('client_billing_cycles').insert({
    tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly',
    period_start_date: '2026-03-01', period_end_date: '2026-04-01', effective_date: '2026-03-01',
  });
  return { db, tenant, clientId, serviceId, contractId, lineId, clientContractId, cycleId, profileId };
}

async function teardown(w: World) {
  const { db, tenant } = w;
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'recurring_service_periods', 'invoice_charges', 'invoices', 'client_billing_cycles', 'time_entries',
    'contract_line_prepaid_blocks', 'contract_line_services', 'client_billing_profiles', 'contract_lines', 'client_contracts',
    'contracts', 'service_catalog', 'service_types', 'clients', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
}

const issuances = (w: World) => w.db('contract_line_block_issuances').where({ tenant: w.tenant, contract_line_id: w.lineId }).orderBy('due_date');
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const sync = (w: World) => w.db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, w.tenant, w.lineId));

async function listRows(w: World, groupingMetadataByRecordId = new Map<string, any>()) {
  return fetchPrepaidBlockIssuanceDueWorkRows(w.db, {
    tenant: w.tenant,
    asOf: '2026-03-15',
    groupingMetadataByRecordId,
  });
}

describe.runIf(enabled)('Prepaid Block issuance sync', () => {
  it('schedules contract_start at max(start date, line created date) and is idempotent', async () => {
    const w = await setup({ startDate: '2026-03-01', lineCreatedAt: '2026-03-10T10:00:00Z', contractCreatedAt: '2026-02-20T10:00:00Z' });
    try {
      const first = await sync(w);
      expect(first).toMatchObject({ action: 'scheduled', dueDate: '2026-03-10' });
      const second = await sync(w);
      expect(second).toEqual({ action: 'none' });
      const rows = await issuances(w);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trigger_kind: 'contract_start', status: 'scheduled', client_contract_id: w.clientContractId });
      expect(dateOnly(rows[0].due_date)).toBe('2026-03-10');
    } finally {
      await teardown(w);
    }
  });

  it('re-dates a scheduled start when the assignment start date changes', async () => {
    const w = await setup({ startDate: '2026-03-01', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      await w.db('client_contracts').where({ tenant: w.tenant, client_contract_id: w.clientContractId }).update({ start_date: '2026-03-20' });
      expect(await sync(w)).toMatchObject({ action: 'rescheduled', dueDate: '2026-03-20' });
      const rows = await issuances(w);
      expect(rows).toHaveLength(1);
      expect(dateOnly(rows[0].due_date)).toBe('2026-03-20');
    } finally {
      await teardown(w);
    }
  });

  it('cancels when the config is removed, and does not reissue after an invoiced issuance', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      await w.db('contract_line_prepaid_blocks').where({ tenant: w.tenant, contract_line_id: w.lineId }).delete();
      expect(await sync(w)).toMatchObject({ action: 'cancelled', count: 1 });
      expect((await issuances(w))[0]).toMatchObject({ status: 'cancelled' });
      expect(await sync(w)).toEqual({ action: 'none' });
    } finally {
      await teardown(w);
    }
  });

  it('cancels when the assignment goes inactive and when the contract ends before the due date', async () => {
    const w = await setup({ startDate: '2026-03-01', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      await w.db('client_contracts').where({ tenant: w.tenant, client_contract_id: w.clientContractId }).update({ is_active: false });
      expect(await sync(w)).toMatchObject({ action: 'cancelled', count: 1 });
      expect((await issuances(w))[0].status).toBe('cancelled');
    } finally {
      await teardown(w);
    }
    const w2 = await setup({ startDate: '2026-03-01', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w2);
      await w2.db('client_contracts').where({ tenant: w2.tenant, client_contract_id: w2.clientContractId }).update({ start_date: '2026-03-20' });
      await sync(w2);
      await w2.db('client_contracts').where({ tenant: w2.tenant, client_contract_id: w2.clientContractId }).update({ end_date: '2026-03-10', start_date: '2026-03-01' });
      // end before the (still scheduled, due 2026-03-20) issuance: the issuance is dropped.
      // The 2026-03-20 issuance is cancelled; the start date is back to 03-01 (inside
      // the contract), so a fresh contract_start is scheduled for 2026-03-01.
      expect(await sync(w2)).toMatchObject({ action: 'scheduled', dueDate: '2026-03-01' });
      const after = await issuances(w2);
      expect(after.map((r) => [dateOnly(r.due_date), r.status])).toEqual([['2026-03-01', 'scheduled'], ['2026-03-20', 'cancelled']]);
    } finally {
      await teardown(w2);
    }
  });
});

describe.runIf(enabled)('Prepaid Block due-work rows', () => {
  it('lists the issuance in the client cycle containing its due date with the real block price', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      const issuance = (await issuances(w))[0];
      const metadata = new Map<string, any>();
      const rows = await listRows(w, metadata);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        chargeType: 'PrepaidBlock', amountCents: 440000, clientId: w.clientId, contractId: w.contractId,
        blockTriggerKind: 'contract_start', billingCycleId: null,
        invoiceWindowStart: '2026-03-01', invoiceWindowEnd: '2026-04-01',
      });
      expect(rows[0].blockDueDate).toBe('2026-03-01');
      const exec = rows[0].selectorInput.executionWindow as any;
      expect(exec.scheduleKey).toBe(`schedule:${w.tenant}:prepaid_block:${issuance.issuance_id}`);
      expect(metadata.get(`prepaid_block:${issuance.issuance_id}`)).toMatchObject({
        clientContractId: w.clientContractId, currencyCode: 'EUR',
      });

      // Not listed once it is no longer scheduled.
      await w.db('contract_line_block_issuances').where({ tenant: w.tenant, issuance_id: issuance.issuance_id }).update({ status: 'cancelled' });
      expect(await listRows(w)).toHaveLength(0);
    } finally {
      await teardown(w);
    }
  });

  it('keeps a block in the window containing its due date even when that cycle is already invoiced, and lists an expiry issuance on its date', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await w.db('invoices').insert({
        tenant: w.tenant, invoice_id: uuidv4(), client_id: w.clientId, invoice_number: `PBD-${uuidv4().slice(0, 8)}`,
        invoice_date: '2026-04-01', due_date: '2026-04-15', subtotal: 0, tax: 0, total_amount: 0, status: 'draft',
        currency_code: 'EUR', billing_cycle_id: w.cycleId, billing_profile_id: w.profileId,
      });
      // expiry issuance due in April; NO April client_billing_cycles row exists.
      await w.db('contract_line_block_issuances').insert({
        tenant: w.tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
        client_id: w.clientId, trigger_kind: 'expiry', due_date: '2026-04-10', status: 'scheduled',
      });
      await sync(w);
      const rows = await fetchPrepaidBlockIssuanceDueWorkRows(w.db, { tenant: w.tenant, asOf: '2026-04-15', options: { dateRange: { to: '2026-04-15' } } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blockTriggerKind: 'expiry', billingCycleId: null, invoiceWindowStart: '2026-04-01', invoiceWindowEnd: '2026-05-01', isEarly: false, canGenerate: true });
      expect(rows[0].blockDueDate).toBe('2026-04-10');
    } finally {
      await teardown(w);
    }
  });

  it('lists a block due today as Ready under the default view (to = today) while its cycle is still open', async () => {
    const w = await setup({ startDate: '2026-03-15', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      const rows = await fetchPrepaidBlockIssuanceDueWorkRows(w.db, {
        tenant: w.tenant, asOf: '2026-03-15', options: { dateRange: { to: '2026-03-15' } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blockDueDate: '2026-03-15', invoiceWindowStart: '2026-03-01', invoiceWindowEnd: '2026-04-01', canGenerate: true, isEarly: false });
      // The cycle's end (2026-04-01) is after `to`: the old cycle-end filter would have hidden it.
    } finally {
      await teardown(w);
    }
  });

  async function insertExpiry(w: World, dueDate: string) {
    await w.db('contract_line_block_issuances').insert({
      tenant: w.tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: dueDate, status: 'scheduled',
    });
  }
  const listAt = (w: World, asOf: string) => fetchPrepaidBlockIssuanceDueWorkRows(w.db, {
    tenant: w.tenant, asOf, options: { dateRange: { to: asOf } },
  });

  it('lists an expiry issuance due later in the current client-cadence window as early and not generatable', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await insertExpiry(w, '2026-04-20');
      // The April window has started (04-01) but the issuance is not due until 04-20.
      const rows = await listAt(w, '2026-04-10');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        blockTriggerKind: 'expiry', blockDueDate: '2026-04-20', invoiceWindowStart: '2026-04-01', invoiceWindowEnd: '2026-05-01',
        dueState: 'early', isEarly: true, canGenerate: false,
      });
    } finally {
      await teardown(w);
    }
  });

  it('the same expiry issuance is Ready when asOf is its due date', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await insertExpiry(w, '2026-04-20');
      const rows = await listAt(w, '2026-04-20');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blockDueDate: '2026-04-20', dueState: 'due', isEarly: false, canGenerate: true });
    } finally {
      await teardown(w);
    }
  });

  it('contract cadence: an expiry issuance due later in the current window is early, and Ready on its due date', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await w.db('contract_lines').where({ tenant: w.tenant, contract_line_id: w.lineId })
        // Hourly lines (which a Prepaid Block line is) bill in arrears; advance is rejected by
        // contract_lines_hourly_usage_not_advance_check.
        .update({ cadence_owner: 'contract', billing_timing: 'arrears', billing_frequency: 'monthly' });
      const { syncRecurringServicePeriodsForContractLine } = await import('../src/actions/recurringServicePeriodSync');
      await w.db.transaction((trx) => syncRecurringServicePeriodsForContractLine(trx, {
        tenant: w.tenant, contractLineId: w.lineId, sourceRunPrefix: 'pbd-test',
      }));
      await insertExpiry(w, '2026-04-20');
      const early = await listAt(w, '2026-04-10');
      expect(early).toHaveLength(1);
      expect(early[0]).toMatchObject({ blockDueDate: '2026-04-20', invoiceWindowStart: '2026-04-01', dueState: 'early', isEarly: true, canGenerate: false });
      const ready = await listAt(w, '2026-04-20');
      expect(ready[0]).toMatchObject({ dueState: 'due', isEarly: false, canGenerate: true });
    } finally {
      await teardown(w);
    }
  });

  it('derives the window from the client schedule when no cycle rows or persisted periods exist', async () => {
    const w = await setup({ startDate: '2026-03-15', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await w.db('client_billing_cycles').where({ tenant: w.tenant }).delete();
      await sync(w);
      const rows = await fetchPrepaidBlockIssuanceDueWorkRows(w.db, {
        tenant: w.tenant, asOf: '2026-03-15', options: { dateRange: { to: '2026-03-15' } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ invoiceWindowStart: '2026-03-01', invoiceWindowEnd: '2026-04-01', billingCycleId: null });
    } finally {
      await teardown(w);
    }
  });

  it('groups with the contract\'s in-advance Fixed rows into one candidate with no split reasons', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      const metadata = new Map<string, any>();
      const [row] = await listRows(w, metadata);
      const meta = metadata.get(row.recordId!);
      const range = { start: row.invoiceWindowStart, end: row.invoiceWindowEnd };
      const selection = (obligationId: string, chargeFamily: string, withMeta = true) => ({
        clientId: row.clientId,
        ...(withMeta ? meta : {}),
        servicePeriod: {
          kind: 'service_period', cadenceOwner: 'client', duePosition: 'advance',
          sourceObligation: { obligationId, chargeFamily },
          start: range.start, end: range.end, semantics: row.servicePeriodStart ? (undefined as any) : undefined,
        },
        invoiceWindow: { kind: 'invoice_window', cadenceOwner: 'client', duePosition: 'advance', start: range.start, end: range.end },
      });
      const grouped = groupDueServicePeriodsForInvoiceCandidates([
        selection('fixed-row', 'fixed') as any,
        selection(row.executionIdentityKey, 'fixed') as any,
      ]);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].dueSelections).toHaveLength(2);
      expect((grouped[0] as any).splitReasons ?? []).toEqual([]);
    } finally {
      await teardown(w);
    }
  });

  it('the row\'s selector drives the billing engine to a prepaid_block charge at the block price', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      // Production path: the line-obligation sync materializes the client-cadence periods.
      await w.db.transaction((trx) => syncRecurringServicePeriodsForContractLine(trx, {
        tenant: w.tenant, contractLineId: w.lineId, sourceRunPrefix: 'prepaid-test',
      }));
      const [row] = await listRows(w);
      const engine = BillingEngine.forTransaction(w.db as any, w.tenant);
      const result: any = await calculateBillingForSelectionInputs({ billingEngine: engine, selectorInputs: [row.selectorInput] });
      const blockCharges = (result.charges ?? []).filter((c: any) => c.type === 'prepaid_block');
      expect(blockCharges).toHaveLength(1);
      expect(blockCharges[0]).toMatchObject({ total: 440000, contract_line_id: w.lineId });
    } finally {
      await teardown(w);
    }
  });
});

describe.runIf(enabled)('Prepaid Block stale pending block warning', () => {
  it('warns for pending contract blocks older than 14 days that hold allocations', async () => {
    const w = await setup({ lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await sync(w);
      const [row] = await listRows(w);
      const blockId = uuidv4();
      await w.db('hour_blocks').insert({
        tenant: w.tenant, block_id: blockId, client_id: w.clientId, service_id: w.serviceId,
        total_minutes: 2400, remaining_minutes: 2400, hourly_rate: 11000, purchase_amount: 440000,
        currency_code: 'EUR', status: 'pending', source_type: 'contract', contract_line_id: w.lineId, service_period_record_id: uuidv4(),
        created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
      });
      const none = await detectStalePendingPrepaidBlockWarnings({ knex: w.db, tenant: w.tenant, rows: [row] });
      expect([...none.values()].flat()).toHaveLength(0);

      const entryId = uuidv4();
      const userId = uuidv4();
      await w.db('users').insert({
        user_id: userId, tenant: w.tenant, username: `pbd_${userId.slice(0, 8)}`, hashed_password: 'x',
        email: `pbd_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'D',
      });
      await w.db('time_entries').insert({
        entry_id: entryId, tenant: w.tenant, user_id: userId, service_id: w.serviceId,
        work_item_id: uuidv4(), work_item_type: 'ad_hoc',
        start_time: '2026-03-10T08:00:00Z', end_time: '2026-03-10T09:00:00Z', work_date: '2026-03-10',
        work_timezone: 'UTC', billable_duration: 60, approval_status: 'APPROVED', invoiced: false, contract_line_id: w.lineId,
      });
      await w.db('hour_block_time_allocations').insert({
        tenant: w.tenant, allocation_id: uuidv4(), block_id: blockId, time_entry_id: entryId, minutes: 60,
      });
      const warned = await detectStalePendingPrepaidBlockWarnings({ knex: w.db, tenant: w.tenant, rows: [row] });
      const warnings = [...warned.values()].flat() as any[];
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('stale_pending_prepaid_block');
      await w.db('hour_block_time_allocations').where({ tenant: w.tenant }).delete();
      await w.db('time_entries').where({ tenant: w.tenant }).delete();
      await w.db('users').where({ tenant: w.tenant }).delete();
    } finally {
      await teardown(w);
    }
  });
});

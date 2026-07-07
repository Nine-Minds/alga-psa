/**
 * Profitability Reporting Integration Tests
 *
 * Runs the profitability report actions and the UserCostRate model against a
 * real migrated database — the raw SQL in profitabilityReportActions.ts
 * (revenue / labor / material / ticket-revenue / allocation CTEs) is executed
 * here rather than mocked, covering:
 * - cost-rate resolution precedence and effective-date boundaries (PRD D1/D2)
 * - actual-duration labor costing with approval/attribution counters (D4/D6)
 * - revenue-by-invoice-date vs cost-by-work-date timing (D5)
 * - the invoice_time_entries.item_id link written by persistInvoiceCharges and
 *   read back as exact ticket revenue (D7/D8)
 * - agreement attribution through contract_lines → contracts → client_contracts
 * - client/agreement/ticket reconciliation against the summary (F054)
 * - material cost/revenue dating and buckets (D13)
 *
 * Bootstrap follows invoiceStatusManagement.integration.test.ts: a dedicated
 * database is dropped/recreated, migrated (CE+EE) and dev-seeded per run.
 * Fixtures live in their own tenant, so the dev-seed tenant's data doubles as
 * a tenant-isolation check: any cross-tenant leak breaks the hand-computed
 * totals below.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knex as knexFactory } from 'knex';

const HOOK_TIMEOUT = 300_000;

const holder = vi.hoisted(() => ({
  db: null as unknown as import('knex').Knex,
  tenantId: '',
  userId: '',
  permissionGranted: true,
  permissionCalls: [] as Array<[string | undefined, string | undefined]>,
}));

vi.mock('@alga-psa/auth', () => {
  const getCurrentUser = vi.fn(async () => ({ user_id: holder.userId, tenant: holder.tenantId }));
  const hasPermission = vi.fn(async () => holder.permissionGranted);
  const getSession = vi.fn(async () => ({ user: { id: holder.userId, tenant: holder.tenantId } }));
  return {
    getSession,
    getCurrentUser,
    hasPermission,
    withAuth: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action({ user_id: holder.userId, tenant: holder.tenantId }, { tenant: holder.tenantId }, ...args),
    withOptionalAuth: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action({ user_id: holder.userId, tenant: holder.tenantId }, { tenant: holder.tenantId }, ...args),
    withAuthCheck: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action({ user_id: holder.userId, tenant: holder.tenantId }, ...args),
  };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource?: string, action?: string) => {
    holder.permissionCalls.push([resource, action]);
    return holder.permissionGranted;
  }),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.db, tenant: holder.tenantId }),
}));

import { tenantDb } from '@alga-psa/db';
import {
  getProfitabilitySummary,
  getClientProfitability,
  getAgreementProfitability,
  getTicketProfitability,
  type ProfitabilitySummary,
} from '@alga-psa/billing/actions/profitabilityReportActions';
import { UserCostRate, CostRateValidationError } from '@alga-psa/billing/models/userCostRate';
import { persistInvoiceCharges } from '@alga-psa/billing/services/invoiceService';

let db: Knex;
let tenantId: string;
let clientId: string;
let userId: string;
let clientContractId: string;
let contractLineId: string;
let ticketId: string;
let ticket2Id: string;
let invoiceId: string;
let timeChargeItemId: string;
let summaryBeforeRates: ProfitabilitySummary;

const RANGE = { startDate: '2025-06-01', endDate: '2025-06-30' };
const EARLY_JUNE = { startDate: '2025-06-01', endDate: '2025-06-14' };
const MAY = { startDate: '2025-05-01', endDate: '2025-05-31' };

// Rates: tenant default 6000 c/hr from 2025-01-01; user override 9000 c/hr from 2025-06-15.
// Entries (all June 2025, one internal user):
//   e1 ticket   06-10  60 min  APPROVED   on contract line -> default rate  -> 6000
//   e2 ticket   06-20  90 min  SUBMITTED  on contract line -> override rate -> 13500
//   e3 ad_hoc   06-25  30 min  DRAFT      no work item     -> override rate -> 4500 ("No client")
const DEFAULT_RATE = 6000;
const OVERRIDE_RATE = 9000;
const EXPECTED_LABOR = 6000 + 13500 + 4500; // 24000 (June work only; e4 costs in May)
const EXPECTED_MINUTES = 60 + 90 + 30; // 180
const TIME_CHARGE_CENTS = 15_000; // one hourly charge on the June invoice, linked to e1
const BILLED_MATERIAL_REVENUE = 2 * 2500; // m1: qty 2 @ 2500, billed on the June invoice
const BILLED_MATERIAL_COST = 2 * 2000; // service cost 2000
const UNBILLED_MATERIAL_COST = 1 * 2000; // m2: qty 1, unbilled, created 06-05
// Arrears fixture: a fixed charge on a second June-dated invoice whose detail
// service period is May; its weighting hours (e4, ticket TK2) are entirely
// outside the June report range.
const FIXED_CHARGE_CENTS = 9000;
const EXPECTED_REVENUE = TIME_CHARGE_CENTS + BILLED_MATERIAL_REVENUE + FIXED_CHARGE_CENTS; // 29000
const EXPECTED_MATERIAL_COST = BILLED_MATERIAL_COST + UNBILLED_MATERIAL_COST; // 6000

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

describe('Profitability Reporting Integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';

    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    holder.db = db;

    tenantId = uuidv4();
    holder.tenantId = tenantId;
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates its own tenant')
      .insert({
        tenant: tenantId,
        client_name: 'Profitability Test Tenant',
        email: 'profitability@test.co',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    clientId = uuidv4();
    await table('clients').insert({
      client_id: clientId,
      tenant: tenantId,
      client_name: 'Margin Test Client',
      billing_email: 'billing@margin.test',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    userId = uuidv4();
    holder.userId = userId;
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'profitability-tester',
      email: 'profitability-tester@test.co',
      hashed_password: 'test_hash',
      first_name: 'Profit',
      last_name: 'Tester',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const serviceTypeId = uuidv4();
    await table('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: 'Profitability Test Type',
    });

    const serviceId = uuidv4();
    await table('service_catalog').insert({
      service_id: serviceId,
      tenant: tenantId,
      service_name: 'Test Hardware',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      default_rate: 2500,
      cost: 2000,
    });

    const contractId = uuidv4();
    await table('contracts').insert({
      contract_id: contractId,
      tenant: tenantId,
      contract_name: 'Managed Services Agreement',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    contractLineId = uuidv4();
    await table('contract_lines').insert({
      contract_line_id: contractLineId,
      tenant: tenantId,
      contract_id: contractId,
      contract_line_name: 'Hourly Support',
      contract_line_type: 'Hourly',
    });

    clientContractId = uuidv4();
    await table('client_contracts').insert({
      client_contract_id: clientContractId,
      tenant: tenantId,
      client_id: clientId,
      contract_id: contractId,
      start_date: '2025-01-01',
      end_date: null,
    });

    ticketId = uuidv4();
    await table('tickets').insert({
      ticket_id: ticketId,
      tenant: tenantId,
      ticket_number: 'PROF-1001',
      title: 'Server down',
      client_id: clientId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const timeEntry = (opts: {
      entryId: string;
      workDate: string;
      minutes: number;
      approval: string;
      workItemType: string | null;
      workItemId: string | null;
      contractLine: string | null;
      billable: number;
    }) => ({
      entry_id: opts.entryId,
      tenant: tenantId,
      user_id: userId,
      work_item_id: opts.workItemId,
      work_item_type: opts.workItemType,
      start_time: `${opts.workDate}T10:00:00Z`,
      end_time: `${opts.workDate}T10:00:00Z`.replace(
        '10:00:00',
        `${String(10 + Math.floor(opts.minutes / 60)).padStart(2, '0')}:${String(opts.minutes % 60).padStart(2, '0')}:00`
      ),
      billable_duration: opts.billable,
      approval_status: opts.approval,
      work_date: opts.workDate,
      work_timezone: 'UTC',
      contract_line_id: opts.contractLine,
      invoiced: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const entry1 = uuidv4();
    await table('time_entries').insert([
      timeEntry({
        entryId: entry1,
        workDate: '2025-06-10',
        minutes: 60,
        approval: 'APPROVED',
        workItemType: 'ticket',
        workItemId: ticketId,
        contractLine: contractLineId,
        billable: 60,
      }),
      timeEntry({
        entryId: uuidv4(),
        workDate: '2025-06-20',
        minutes: 90,
        approval: 'SUBMITTED',
        workItemType: 'ticket',
        workItemId: ticketId,
        contractLine: contractLineId,
        billable: 60,
      }),
      timeEntry({
        entryId: uuidv4(),
        workDate: '2025-06-25',
        minutes: 30,
        approval: 'DRAFT',
        workItemType: 'ad_hoc',
        workItemId: null,
        contractLine: null,
        billable: 0,
      }),
    ]);

    // Capture the uncosted state before any rates exist (order-safe under
    // vitest sequence.shuffle; asserted in its own test below).
    summaryBeforeRates = await getProfitabilitySummary(RANGE);

    await UserCostRate.upsert(db, tenantId, {
      user_id: null,
      cost_rate: DEFAULT_RATE,
      effective_from: '2025-01-01',
      effective_to: null,
    });
    await UserCostRate.upsert(db, tenantId, {
      user_id: userId,
      cost_rate: OVERRIDE_RATE,
      effective_from: '2025-06-15',
      effective_to: null,
    });

    invoiceId = uuidv4();
    await table('invoices').insert({
      invoice_id: invoiceId,
      tenant: tenantId,
      client_id: clientId,
      invoice_number: `PROF-${invoiceId.slice(0, 8)}`,
      subtotal: TIME_CHARGE_CENTS,
      tax: 0,
      total_amount: TIME_CHARGE_CENTS,
      status: 'sent',
      currency_code: 'USD',
      credit_applied: 0,
      invoice_date: '2025-06-28T12:00:00Z',
      due_date: '2025-07-28T12:00:00Z',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Persist a real time charge through the production write path so the
    // invoice_time_entries.item_id link (D7) is exercised, not simulated.
    await db.transaction(async (trx) => {
      await persistInvoiceCharges(
        trx,
        invoiceId,
        [
          {
            type: 'time',
            serviceId: null,
            serviceName: 'Hourly Support',
            userId,
            duration: 60,
            quantity: 1,
            rate: TIME_CHARGE_CENTS,
            total: TIME_CHARGE_CENTS,
            tax_amount: 0,
            tax_rate: 0,
            entryId: entry1,
            client_contract_id: clientContractId,
            tenant: tenantId,
          } as any,
        ],
        { client_id: clientId, tax_region: null },
        { user: { id: userId } } as any,
        tenantId
      );
    });
    const chargeRow = await table('invoice_charges').where({ invoice_id: invoiceId }).first();
    timeChargeItemId = chargeRow.item_id;

    // Engine-faithful billed material: the engine emits an invoice charge for
    // the material AND stamps billed_invoice_id (invoiceGeneration.ts ~2217).
    // Revenue must be counted exactly once, via this charge row.
    await table('invoice_charges').insert({
      item_id: uuidv4(),
      tenant: tenantId,
      invoice_id: invoiceId,
      description: 'Material: Test Hardware',
      quantity: 2,
      unit_price: 2500,
      net_amount: BILLED_MATERIAL_REVENUE,
      tax_amount: 0,
      total_price: BILLED_MATERIAL_REVENUE,
      is_manual: false,
      created_at: db.fn.now(),
    });

    // Arrears-billed fixed charge: June-dated invoice, May service period,
    // weighting hours (e4 on TK2) entirely in May — the standard
    // billing-in-arrears shape the allocation must handle (D8).
    const fixedLineId = uuidv4();
    await table('contract_lines').insert({
      contract_line_id: fixedLineId,
      tenant: tenantId,
      contract_id: (await table('client_contracts').where({ client_contract_id: clientContractId }).first()).contract_id,
      contract_line_name: 'Fixed Support',
      contract_line_type: 'Fixed',
    });
    const configId = uuidv4();
    await table('contract_line_service_configuration').insert({
      config_id: configId,
      tenant: tenantId,
      contract_line_id: fixedLineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
    });

    ticket2Id = uuidv4();
    await table('tickets').insert({
      ticket_id: ticket2Id,
      tenant: tenantId,
      ticket_number: 'PROF-1002',
      title: 'Monthly maintenance',
      client_id: clientId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await table('time_entries').insert(
      timeEntry({
        entryId: uuidv4(),
        workDate: '2025-05-20',
        minutes: 120,
        approval: 'APPROVED',
        workItemType: 'ticket',
        workItemId: ticket2Id,
        contractLine: fixedLineId,
        billable: 0,
      })
    );

    const invoice2Id = uuidv4();
    await table('invoices').insert({
      invoice_id: invoice2Id,
      tenant: tenantId,
      client_id: clientId,
      invoice_number: `PROF-${invoice2Id.slice(0, 8)}`,
      subtotal: FIXED_CHARGE_CENTS,
      tax: 0,
      total_amount: FIXED_CHARGE_CENTS,
      status: 'sent',
      currency_code: 'USD',
      credit_applied: 0,
      invoice_date: '2025-06-28T12:00:00Z',
      due_date: '2025-07-28T12:00:00Z',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const fixedChargeItemId = uuidv4();
    await table('invoice_charges').insert({
      item_id: fixedChargeItemId,
      tenant: tenantId,
      invoice_id: invoice2Id,
      description: 'Fixed Plan Charge',
      quantity: 1,
      unit_price: FIXED_CHARGE_CENTS,
      net_amount: FIXED_CHARGE_CENTS,
      tax_amount: 0,
      total_price: FIXED_CHARGE_CENTS,
      is_manual: false,
      client_contract_id: clientContractId,
      created_at: db.fn.now(),
    });
    const fixedDetailId = uuidv4();
    await table('invoice_charge_details').insert({
      item_detail_id: fixedDetailId,
      tenant: tenantId,
      item_id: fixedChargeItemId,
      service_id: serviceId,
      config_id: configId,
      quantity: 1,
      rate: FIXED_CHARGE_CENTS,
      service_period_start: '2025-05-01',
      service_period_end: '2025-05-31',
    });
    await table('invoice_charge_fixed_details').insert({
      item_detail_id: fixedDetailId,
      tenant: tenantId,
      allocated_amount: FIXED_CHARGE_CENTS,
    });

    await table('ticket_materials').insert([
      {
        ticket_material_id: uuidv4(),
        tenant: tenantId,
        ticket_id: ticketId,
        client_id: clientId,
        service_id: serviceId,
        quantity: 2,
        rate: 2500,
        currency_code: 'USD',
        is_billed: true,
        billed_invoice_id: invoiceId,
        created_at: '2025-06-11T12:00:00Z',
        updated_at: db.fn.now(),
      },
      {
        ticket_material_id: uuidv4(),
        tenant: tenantId,
        ticket_id: ticketId,
        client_id: clientId,
        service_id: serviceId,
        quantity: 1,
        rate: 1000,
        currency_code: 'USD',
        is_billed: false,
        billed_invoice_id: null,
        created_at: '2025-06-05T12:00:00Z',
        updated_at: db.fn.now(),
      },
    ]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('reports an explicit uncosted state before any cost rates exist', () => {
    expect(summaryBeforeRates.costRatesConfigured).toBe(false);
    expect(summaryBeforeRates.laborCost).toBe(0);
    expect(summaryBeforeRates.uncostedMinutes).toBe(EXPECTED_MINUTES);
    expect(summaryBeforeRates.totalMinutes).toBe(EXPECTED_MINUTES);
  });

  it('persistInvoiceCharges writes a 1:1 invoice_time_entries.item_id link (D7)', async () => {
    const links = await table('invoice_time_entries').where({ invoice_id: invoiceId });
    expect(links).toHaveLength(1);
    expect(links[0].item_id).toBe(timeChargeItemId);
  });

  it('rejects an overlapping cost-rate range against the live schema', async () => {
    // Bounded range: an open-ended insert would instead supersede the
    // current open default rate and rewrite the timeline for later tests.
    await expect(
      UserCostRate.upsert(db, tenantId, {
        user_id: null,
        cost_rate: 7000,
        effective_from: '2025-03-01',
        effective_to: '2025-03-31',
      })
    ).rejects.toBeInstanceOf(CostRateValidationError);
  });

  it('resolves rates with user-over-default precedence across the effective boundary', async () => {
    const before = await UserCostRate.resolveCostRate(db, tenantId, userId, '2025-06-14');
    expect(before?.cost_rate).toBe(DEFAULT_RATE);
    const onBoundary = await UserCostRate.resolveCostRate(db, tenantId, userId, '2025-06-15');
    expect(onBoundary?.cost_rate).toBe(OVERRIDE_RATE);
    const otherUser = await UserCostRate.resolveCostRate(db, tenantId, uuidv4(), '2025-06-20');
    expect(otherUser?.cost_rate).toBe(DEFAULT_RATE);
  });

  it('computes hand-verified summary totals across the rate boundary', async () => {
    const summary = await getProfitabilitySummary(RANGE);
    expect(summary.costRatesConfigured).toBe(true);
    expect(summary.revenue).toBe(EXPECTED_REVENUE);
    expect(summary.laborCost).toBe(EXPECTED_LABOR);
    expect(summary.materialCost).toBe(EXPECTED_MATERIAL_COST);
    expect(summary.totalMinutes).toBe(EXPECTED_MINUTES);
    expect(summary.uncostedMinutes).toBe(0);
    expect(summary.unapprovedMinutes).toBe(90 + 30);
    expect(summary.unattributedMinutes).toBe(30);
    expect(summary.zeroDurationEntryCount).toBe(0);
    expect(summary.uncostedMaterialCount).toBe(0);
    expect(summary.unconvertedRevenueCount).toBe(0);
    expect(summary.margin).toBe(EXPECTED_REVENUE - EXPECTED_LABOR - EXPECTED_MATERIAL_COST);
    expect(summary.effectiveHourlyRate).toBe(Math.round((EXPECTED_REVENUE * 60) / EXPECTED_MINUTES));
  });

  it('applies revenue by invoice date and cost by work date (D5)', async () => {
    const summary = await getProfitabilitySummary(EARLY_JUNE);
    expect(summary.revenue).toBe(0); // invoice dated 06-28
    expect(summary.laborCost).toBe(6000); // only e1 (06-10)
    expect(summary.materialCost).toBe(UNBILLED_MATERIAL_COST); // m2 created 06-05; m1 dated by invoice
    expect(summary.marginPct).toBeNull();
  });

  it('reconciles client rows to the summary and isolates clientless work (F054/D6)', async () => {
    const [summary, clients] = [await getProfitabilitySummary(RANGE), await getClientProfitability(RANGE)];
    for (const field of ['revenue', 'laborCost', 'materialCost', 'totalMinutes'] as const) {
      expect(clients.reduce((total, row) => total + row[field], 0)).toBe(summary[field]);
    }
    const noClient = clients.find((row) => row.clientId === null);
    expect(noClient?.totalMinutes).toBe(30);
    expect(noClient?.laborCost).toBe(4500);
  });

  it('attributes contract-line time to the agreement and reconciles agreement rows (F029/F054)', async () => {
    const [summary, agreements] = [await getProfitabilitySummary(RANGE), await getAgreementProfitability(RANGE)];
    for (const field of ['revenue', 'laborCost', 'totalMinutes'] as const) {
      expect(agreements.reduce((total, row) => total + row[field], 0)).toBe(summary[field]);
    }

    const agreementRow = agreements.find((row) => row.rowType === 'agreement');
    expect(agreementRow?.clientContractId).toBe(clientContractId);
    expect(agreementRow?.revenue).toBe(TIME_CHARGE_CENTS + FIXED_CHARGE_CENTS);
    expect(agreementRow?.laborCost).toBe(6000 + 13500);
    expect(agreementRow?.lines.some((line) => line.contractLineId === contractLineId)).toBe(true);

    const adHocRow = agreements.find((row) => row.rowType === 'ad_hoc' && row.clientId === clientId);
    expect(adHocRow?.revenue).toBe(BILLED_MATERIAL_REVENUE);

    const unattributedForClient = agreements.find(
      (row) => row.rowType === 'unattributed' && row.clientId === clientId
    );
    expect(unattributedForClient?.materialCost).toBe(EXPECTED_MATERIAL_COST);
  });

  it('reads exact ticket revenue back through the item_id link (D8 exact path)', async () => {
    const tickets = await getTicketProfitability(RANGE);
    const row = tickets.find((ticket) => ticket.ticketId === ticketId);
    expect(row).toBeDefined();
    expect(row!.attribution).toBe('exact');
    expect(row!.totalMinutes).toBe(150);
    expect(row!.laborCost).toBe(6000 + 13500);
    expect(row!.revenue).toBe(TIME_CHARGE_CENTS + BILLED_MATERIAL_REVENUE);
    expect(row!.materialCost).toBe(EXPECTED_MATERIAL_COST); // both materials sit on this ticket
    expect(row!.margin).toBe(row!.revenue - row!.laborCost - row!.materialCost);
    expect(row!.uncosted).toBe(false);
  });

  it('denies every report action without billing.read and checks the right resource', async () => {
    holder.permissionGranted = false;
    holder.permissionCalls = [];
    try {
      await expect(getProfitabilitySummary(RANGE)).rejects.toThrow(/Permission denied/);
      await expect(getClientProfitability(RANGE)).rejects.toThrow(/Permission denied/);
      await expect(getAgreementProfitability(RANGE)).rejects.toThrow(/Permission denied/);
      await expect(getTicketProfitability(RANGE)).rejects.toThrow(/Permission denied/);
    } finally {
      holder.permissionGranted = true;
    }
    expect(holder.permissionCalls).toContainEqual(['billing', 'read']);
    expect(holder.permissionCalls).toHaveLength(4);
  });

  it('counts engine-billed material revenue exactly once (charge row is authoritative)', async () => {
    // The base fixture is engine-faithful: the billed material has BOTH its
    // invoice_charges row and billed_invoice_id set. EXPECTED_REVENUE counts
    // that money once; a regression re-adding the material fact's revenue at
    // summary grain shows up here as +5000.
    const summary = await getProfitabilitySummary(RANGE);
    expect(summary.revenue).toBe(EXPECTED_REVENUE);
  });

  it('allocates arrears-billed fixed revenue to tickets worked in the charge window (D8)', async () => {
    // Invoice dated June, service period May, hours in May only: the June
    // report must still allocate the charge to TK2 as a revenue-only row.
    const tickets = await getTicketProfitability(RANGE);
    const row = tickets.find((ticket) => ticket.ticketId === ticket2Id);
    expect(row).toBeDefined();
    expect(row!.attribution).toBe('allocated');
    expect(row!.revenue).toBe(FIXED_CHARGE_CENTS);
    expect(row!.totalMinutes).toBe(0); // its hours belong to May's cost
    expect(row!.laborCost).toBe(0);
    expect(row!.clientContractId).toBe(clientContractId);

    // The May report carries the matching cost side (D5).
    const maySummary = await getProfitabilitySummary(MAY);
    expect(maySummary.laborCost).toBe(Math.round((120 * DEFAULT_RATE) / 60)); // e4 pre-override
    expect(maySummary.revenue).toBe(0);
  });
});

async function createTestDbConnection(): Promise<Knex> {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = process.env.DB_PASSWORD_ADMIN || 'postpass123';
  const dbName = 'profitability_reporting_test';

  const adminConnection = knexFactory({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
  });

  try {
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [dbName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminConnection.raw(`CREATE DATABASE "${dbName}"`);
  } finally {
    await adminConnection.destroy();
  }

  return knexFactory({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: dbName,
    },
    pool: { min: 2, max: 10 },
  });
}

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "vector"').catch(() => undefined);
  // Stand-in Citus catalog so migration distribution probes succeed quietly
  // on plain Postgres (see test-utils/dbConfig.ts).
  await connection.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');

  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(testDir, '..', '..', '..', '..');
  const projectRoot = path.resolve(serverDir, '..');

  await connection.migrate.latest({
    directory: [path.join(serverDir, 'migrations'), path.join(projectRoot, 'ee', 'server', 'migrations')],
    loadExtensions: ['.cjs', '.js'],
  });

  await connection.seed.run({
    directory: path.join(serverDir, 'seeds', 'dev'),
    loadExtensions: ['.cjs', '.js'],
  });
}

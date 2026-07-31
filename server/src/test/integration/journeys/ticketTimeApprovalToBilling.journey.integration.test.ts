import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { createUser } from '../../../../test-utils/testDataFactory';
import { createTestTimeEntry } from '../../e2e/utils/timeEntryTestDataFactory';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../test-utils/billingTestHelpers';

// P0 journey (docs: journey-first testing pivot): the thinnest-covered money
// path — a tech logs time against a ticket, the timesheet goes through real
// submit/approve, and ONLY then does the hourly work land on the client's
// invoice. The approval gate is the assertion that matters: unapproved time
// must not bill.

let db: Knex;
let tenantId: string;
let currentUser: { user_id: string; user_type: string };
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let submitTimeSheet: typeof import('@alga-psa/scheduling/actions/timeSheetOperations').submitTimeSheet;
let approveTimeSheet: typeof import('@alga-psa/scheduling/actions/timeSheetActions').approveTimeSheet;

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth/withAuth')>('@alga-psa/auth/withAuth');
  return {
    ...actual,
    withAuth: (action: (...args: any[]) => Promise<unknown>) =>
      (...args: any[]) =>
        action(
          { ...currentUser, roles: [{ role_name: 'Admin' }], tenant: tenantId } as any,
          { tenant: tenantId },
          ...args,
        ),
  };
});

// scheduling actions import withAuth from the barrel, not the subpath
vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: (action: (...args: any[]) => Promise<unknown>) =>
      (...args: any[]) =>
        action(
          { ...currentUser, roles: [{ role_name: 'Admin' }], tenant: tenantId } as any,
          { tenant: tenantId },
          ...args,
        ),
    hasPermission: vi.fn(async () => true),
    getCurrentUser: vi.fn(async () => ({
      ...currentUser,
      roles: [{ role_name: 'Admin' }],
      tenant: tenantId,
    })),
  };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

const HOURLY_RATE_CENTS = 12000;

describe('journey: ticket → time → approval → billing', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    currentUser = { user_id: uuidv4(), user_type: 'internal' };
    setupCommonMocks({ tenantId, userId: currentUser.user_id, permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ submitTimeSheet } = await import('@alga-psa/scheduling/actions/timeSheetOperations'));
    ({ approveTimeSheet } = await import('@alga-psa/scheduling/actions/timeSheetActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('bills two approved hours from a ticket, and refuses to bill them before approval', async () => {
    // --- client + cycles + tax, as in the wizard→invoice journey ---
    const clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey Time Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '2 Journey Way',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      email: `${clientId.slice(0, 8)}@journey.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const contextLike = { db, tenantId, clientId } as const;
    await ensureDefaultBillingSettings(contextLike as any);
    await ensureClientPlanBundlesTable(contextLike as any);
    await setupClientTaxConfiguration(contextLike as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });

    const januaryCycleId = uuidv4();
    await tenantTable(db, tenantId, 'client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // --- an hourly service + wizard contract for it ---
    const serviceTypeId = uuidv4();
    await tenantTable(db, tenantId, 'service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Hourly Support ${serviceTypeId.slice(0, 8)}`,
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    const serviceId = uuidv4();
    await tenantTable(db, tenantId, 'service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: 'Journey Remote Support',
      description: 'hourly journey service',
      default_rate: HOURLY_RATE_CENTS,
      unit_of_measure: 'hour',
      billing_method: 'per_unit',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });
    // Hourly rate resolution reads currency-tagged service_prices, never the
    // legacy currency-untagged service_catalog.default_rate.
    await tenantTable(db, tenantId, 'service_prices').insert({
      tenant: tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: HOURLY_RATE_CENTS
    });

    const wizardResult = await createClientContractFromWizard({
      contract_name: 'Journey Hourly Support',
      description: 'hourly journey contract',
      client_id: clientId,
      start_date: DECEMBER_START,
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [{ service_id: serviceId, hourly_rate: HOURLY_RATE_CENTS }],
      usage_services: [],
      po_required: false
    });
    expect(wizardResult.contract_id).toBeDefined();
    expect(wizardResult.contract_line_id).toBeDefined();

    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: wizardResult.contract_line_id!,
        sourceRunPrefix: 'journey-time-test',
      });
    });

    // --- people: a tech who logs the time and an approver ---
    const techId = await createUser(db, tenantId, {
      email: `tech-${uuidv4().slice(0, 8)}@journey.test`,
      user_type: 'internal',
      first_name: 'Journey',
      last_name: 'Tech'
    });
    const approverId = await createUser(db, tenantId, {
      email: `approver-${uuidv4().slice(0, 8)}@journey.test`,
      user_type: 'internal',
      first_name: 'Journey',
      last_name: 'Approver'
    });

    // --- a ticket the time is worked against ---
    const statusId = uuidv4();
    await tenantTable(db, tenantId, 'statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: `Journey Open ${statusId.slice(0, 6)}`,
      status_type: 'ticket',
      is_closed: false,
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now()
    });
    const boardId = uuidv4();
    await tenantTable(db, tenantId, 'boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: `Journey Board ${boardId.slice(0, 6)}`,
      is_inactive: false
    });
    const ticketId = uuidv4();
    await tenantTable(db, tenantId, 'tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `JT-${ticketId.slice(0, 8)}`,
      title: 'Printer on fire (journey)',
      client_id: clientId,
      status_id: statusId,
      board_id: boardId,
      entered_by: techId,
      entered_at: `${DECEMBER_START}T09:00:00Z`,
      updated_at: db.fn.now()
    });

    // --- a December time period + the tech's timesheet + a 2h entry ---
    const periodId = uuidv4();
    await tenantTable(db, tenantId, 'time_periods').insert({
      period_id: periodId,
      tenant: tenantId,
      start_date: `${DECEMBER_START}T00:00:00Z`,
      end_date: `${JANUARY_START}T00:00:00Z`
    });
    const timeSheetId = uuidv4();
    await tenantTable(db, tenantId, 'time_sheets').insert({
      id: timeSheetId,
      tenant: tenantId,
      period_id: periodId,
      user_id: techId,
      approval_status: 'DRAFT'
    });

    const entry = await createTestTimeEntry(db, tenantId, {
      work_item_id: ticketId,
      work_item_type: 'ticket',
      service_id: serviceId,
      user_id: techId,
      start_time: new Date('2024-12-10T10:00:00Z'),
      end_time: new Date('2024-12-10T12:00:00Z'),
      billable_duration: 120,
      time_sheet_id: timeSheetId,
      approval_status: 'DRAFT',
      contract_line_id: wizardResult.contract_line_id!,
      tax_region: 'US-NY'
    });

    // --- the approval gate: the engine refuses the whole invoice while any
    // entry in the window is unapproved ---
    await expect(generateInvoice(januaryCycleId)).rejects.toThrow(/Blocked until approval/);
    const entryBeforeApproval = await tenantTable(db, tenantId, 'time_entries')
      .where({ tenant: tenantId, entry_id: entry.entry_id })
      .first();
    expect(entryBeforeApproval?.invoiced).toBe(false);

    // --- real submit + approve, as the UI drives them ---
    currentUser = { user_id: techId, user_type: 'internal' };
    const submitResult = await submitTimeSheet(timeSheetId);
    expect((submitResult as any)?.approval_status ?? (submitResult as any)?.actionError).toBe('SUBMITTED');

    currentUser = { user_id: approverId, user_type: 'internal' };
    const approveResult = await approveTimeSheet(timeSheetId, approverId);
    expect((approveResult as any)?.actionError ?? (approveResult as any)?.permissionError ?? null).toBeNull();

    const sheetAfter = await tenantTable(db, tenantId, 'time_sheets')
      .where({ tenant: tenantId, id: timeSheetId })
      .first();
    expect(sheetAfter?.approval_status).toBe('APPROVED');

    // --- now the invoice picks the hours up: 2h × 120.00 = 240.00 ---
    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();
    expect((invoice as any)?.actionError).toBeUndefined();
    expect(invoice?.invoice_id).toBeDefined();
    expect(Number(invoice?.subtotal)).toBe(2 * HOURLY_RATE_CENTS);

    const charges = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, invoice_id: invoice!.invoice_id });
    expect(charges.length).toBeGreaterThan(0);

    const entryAfter = await tenantTable(db, tenantId, 'time_entries')
      .where({ tenant: tenantId, entry_id: entry.entry_id })
      .first();
    expect(entryAfter?.approval_status).toBe('APPROVED');
    expect(entryAfter?.invoiced).toBe(true);
  }, HOOK_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}

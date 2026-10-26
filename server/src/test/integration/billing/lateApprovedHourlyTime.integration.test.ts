import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

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
import { seedBillingCycle } from '../../../../test-utils/billingProfileTestHelpers';

// Approved hourly time dated inside a service period that an earlier invoice
// already closed (approved late, or logged after the run) must neither vanish
// nor reopen that invoice. It bills once, on the contract line's next invoice,
// carrying the service period it belongs to.

let db: Knex;
let tenantId: string;
let currentUser: { user_id: string; user_type: string };
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let previewInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').previewInvoice;
let getLateApprovedHourlyTime: typeof import('@alga-psa/billing/actions/billingAndTax').getLateApprovedHourlyTime;
let updateClientContractForBilling: typeof import('@alga-psa/billing/actions/billingClientsActions').updateClientContractForBilling;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;

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
    // The real withTransaction: it owns the transaction that after-commit hooks
    // flush from, and lifecycle/ownership admission refuses a bare connection.
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
const HOURLY_RATE_CENTS = 12000;

type Fixture = {
  clientId: string;
  serviceId: string;
  contractLineId: string;
  techId: string;
  ticketId: string;
  cycleIds: { january: string; february: string };
};

async function seedHourlyClient(): Promise<Fixture> {
  const clientId = uuidv4();
  await tenantTable(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Late Time Client ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '3 Late Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `${clientId.slice(0, 8)}@late-time.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const contextLike = { db, tenantId, clientId } as const;
  await ensureDefaultBillingSettings(contextLike as any);
  await ensureClientPlanBundlesTable(contextLike as any);
  await setupClientTaxConfiguration(contextLike as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 0,
  });

  const cycleIds = { january: uuidv4(), february: uuidv4() };
  for (const [cycleId, start, end] of [
    [cycleIds.january, '2025-01-01', '2025-02-01'],
    [cycleIds.february, '2025-02-01', '2025-03-01'],
  ] as const) {
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: cycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${start}T00:00:00Z`,
      period_start_date: `${start}T00:00:00Z`,
      period_end_date: `${end}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  const serviceTypeId = uuidv4();
  await tenantTable(db, tenantId, 'service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Late Hourly ${serviceTypeId.slice(0, 8)}`,
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const serviceId = uuidv4();
  await tenantTable(db, tenantId, 'service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: 'Late Remote Support',
    description: 'hourly late-time service',
    default_rate: 5000,
    unit_of_measure: 'hour',
    billing_method: 'per_unit',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });
  // Catalog price deliberately differs from the contract rate: the contract
  // rate must still win for carried-forward time.
  await tenantTable(db, tenantId, 'service_prices').insert({
    tenant: tenantId,
    service_id: serviceId,
    currency_code: 'USD',
    rate: 5000,
  });

  const wizardResult = await createClientContractFromWizard({
    contract_name: 'Late Hourly Support',
    description: 'hourly late-time contract',
    client_id: clientId,
    start_date: '2024-12-01',
    end_date: null,
    billing_frequency: 'monthly',
    enable_proration: false,
    fixed_services: [],
    hourly_services: [{ service_id: serviceId, hourly_rate: HOURLY_RATE_CENTS }],
    usage_services: [],
    po_required: false,
  });
  const contractLineId = wizardResult.contract_line_id!;
  expect(contractLineId).toBeDefined();
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId,
      sourceRunPrefix: 'late-time-test',
    });
  });

  const techId = await createUser(db, tenantId, {
    email: `late-tech-${uuidv4().slice(0, 8)}@late-time.test`,
    user_type: 'internal',
    first_name: 'Late',
    last_name: 'Tech',
  });
  const statusId = uuidv4();
  await tenantTable(db, tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    name: `Late Open ${statusId.slice(0, 6)}`,
    status_type: 'ticket',
    is_closed: false,
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
  });
  const boardId = uuidv4();
  await tenantTable(db, tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: `Late Board ${boardId.slice(0, 6)}`,
    is_inactive: false,
  });
  const ticketId = uuidv4();
  await tenantTable(db, tenantId, 'tickets').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    ticket_number: `LT-${ticketId.slice(0, 8)}`,
    title: 'Late approved work',
    client_id: clientId,
    status_id: statusId,
    board_id: boardId,
    entered_by: techId,
    entered_at: '2024-12-01T09:00:00Z',
    updated_at: db.fn.now(),
  });

  return { clientId, serviceId, contractLineId, techId, ticketId, cycleIds };
}

async function logApprovedHours(fixture: Fixture, start: string, minutes: number) {
  const startTime = new Date(start);
  return createTestTimeEntry(db, tenantId, {
    work_item_id: fixture.ticketId,
    work_item_type: 'ticket',
    service_id: fixture.serviceId,
    user_id: fixture.techId,
    start_time: startTime,
    end_time: new Date(startTime.getTime() + minutes * 60_000),
    billable_duration: minutes,
    approval_status: 'APPROVED',
    contract_line_id: fixture.contractLineId,
    tax_region: 'US-NY',
  });
}

async function invoiceSnapshot(invoiceId: string) {
  const invoice = await tenantTable(db, tenantId, 'invoices').where({ invoice_id: invoiceId }).first();
  const charges = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: invoiceId })
    .orderBy('item_id')
    .select('item_id', 'description', 'quantity', 'unit_price', 'net_amount', 'total_price');
  const links = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ invoice_id: invoiceId })
    .orderBy('entry_id')
    .select('entry_id');
  return {
    subtotal: Number((invoice as any)?.subtotal),
    total: Number((invoice as any)?.total_amount),
    status: (invoice as any)?.status,
    charges,
    links: links.map((row: any) => row.entry_id),
  };
}

describe('late approved hourly time in an already-invoiced service period', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    currentUser = { user_id: uuidv4(), user_type: 'internal' };
    setupCommonMocks({ tenantId, userId: currentUser.user_id, permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ getLateApprovedHourlyTime } = await import('@alga-psa/billing/actions/billingAndTax'));
    ({ updateClientContractForBilling } = await import('@alga-psa/billing/actions/billingClientsActions'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('bills late contract-rated time once on the next invoice and leaves the closed invoice untouched', async () => {
    const fixture = await seedHourlyClient();

    // 1. December service is invoiced on the January run.
    const onTime = await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 120);
    const january = await generateInvoice(fixture.cycleIds.january);
    expect((january as any)?.actionError).toBeUndefined();
    expect(Number(january?.subtotal)).toBe(2 * HOURLY_RATE_CENTS);
    const januaryBefore = await invoiceSnapshot(january!.invoice_id);
    expect(januaryBefore.links).toEqual([onTime.entry_id]);

    // 2. More December time is approved after that invoice exists.
    const late = await logApprovedHours(fixture, '2024-12-20T10:00:00Z', 50);
    const current = await logApprovedHours(fixture, '2025-01-15T10:00:00Z', 60);
    // Time dated in a service period no invoice has closed yet stays with it.
    const future = await logApprovedHours(fixture, '2025-02-05T10:00:00Z', 60);

    // 3a. Regenerating the closed window never reopens it.
    const rerun = await generateInvoice(fixture.cycleIds.january);
    expect((rerun as any)?.invoice_id ?? null).toBeNull();
    expect(await invoiceSnapshot(january!.invoice_id)).toEqual(januaryBefore);

    // 3b. The next run bills the late December time exactly once under the
    // contract's terms: its 15-minute rounding (50 -> 60 min) and its rate,
    // never the cheaper catalog price.
    const february = await generateInvoice(fixture.cycleIds.february);
    expect((february as any)?.actionError).toBeUndefined();
    expect(february?.invoice_id).toBeDefined();
    const februaryAfter = await invoiceSnapshot(february!.invoice_id);
    expect(februaryAfter.links.sort()).toEqual([late.entry_id, current.entry_id].sort());
    expect(februaryAfter.subtotal).toBe(HOURLY_RATE_CENTS + HOURLY_RATE_CENTS);

    // The late line reports the service period it belongs to, not February's.
    const lateLink = await tenantTable(db, tenantId, 'invoice_time_entries')
      .where({ invoice_id: february!.invoice_id, entry_id: late.entry_id })
      .first();
    const lateCharge = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ item_id: (lateLink as any).item_id })
      .first();
    expect(lateCharge).toBeDefined();
    expect(String((lateCharge as any).description)).toMatch(/2024-12-01/);
    const lateDetail = await tenantTable(db, tenantId, 'invoice_charge_details')
      .where({ item_id: (lateCharge as any).item_id })
      .first();
    expect(new Date((lateDetail as any).service_period_start).toISOString().slice(0, 10)).toBe('2024-12-01');

    // The January (December-service) period stays claimed by its own invoice.
    const decemberPeriod = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ obligation_id: fixture.contractLineId, service_period_start: '2024-12-01' })
      .whereNotIn('lifecycle_state', ['superseded', 'archived'])
      .first();
    expect((decemberPeriod as any)?.invoice_id).toBe(january!.invoice_id);
    const januaryPeriod = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ obligation_id: fixture.contractLineId, service_period_start: '2025-01-01' })
      .whereNotIn('lifecycle_state', ['superseded', 'archived'])
      .first();
    expect((januaryPeriod as any)?.invoice_id).toBe(february!.invoice_id);

    // 4. History is unchanged and a retry bills nothing twice.
    expect(await invoiceSnapshot(january!.invoice_id)).toEqual(januaryBefore);
    await generateInvoice(fixture.cycleIds.february);
    await generateInvoice(fixture.cycleIds.january);
    expect(await invoiceSnapshot(february!.invoice_id)).toEqual(februaryAfter);
    const allLinks = await tenantTable(db, tenantId, 'invoice_time_entries')
      .whereIn('entry_id', [onTime.entry_id, late.entry_id, current.entry_id, future.entry_id])
      .select('entry_id');
    expect(allLinks.map((row: any) => row.entry_id).sort()).toEqual(
      [onTime.entry_id, late.entry_id, current.entry_id].sort(),
    );
    const futureRow = await tenantTable(db, tenantId, 'time_entries').where({ entry_id: future.entry_id }).first();
    expect((futureRow as any)?.invoiced).toBe(false);
  }, HOOK_TIMEOUT);

  const late = async (clientId: string) => {
    const result = await getLateApprovedHourlyTime({ clientId });
    if (!Array.isArray(result)) throw new Error('permission error');
    return result;
  };

  it('names late time in preview and Automatic Invoices; a draft closes its window and the time carries forward', async () => {
    const fixture = await seedHourlyClient();
    await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 60);
    const january = await generateInvoice(fixture.cycleIds.january);
    const lateEntry = await logApprovedHours(fixture, '2024-12-21T10:00:00Z', 60);
    // Negative control: time in a period no invoice has closed is not late.
    const openEntry = await logApprovedHours(fixture, '2025-02-03T10:00:00Z', 60);

    const notices = await late(fixture.clientId);
    expect(notices.map((n) => n.entryId)).toEqual([lateEntry.entry_id]);
    expect(notices[0]).toMatchObject({
      disposition: 'next_invoice', closedPeriodStart: '2024-12-01', closedPeriodEnd: '2024-12-31',
      closedByInvoiceNumber: (january as any).invoice_number, closedByInvoiceStatus: 'draft', billableMinutes: 60,
    });
    expect(notices.map((n) => n.entryId)).not.toContain(openEntry.entry_id);

    // The preview of the next window carries the same notice beside its late line.
    const preview = await previewInvoice(fixture.cycleIds.february);
    expect(preview.success).toBe(true);
    expect((preview as any).lateHourlyTime?.map((n: any) => n.entryId)).toEqual([lateEntry.entry_id]);

    // Decision: a draft closes its window (it cannot be regenerated in place), so the time carries forward.
    await generateInvoice(fixture.cycleIds.february);
    expect((await tenantTable(db, tenantId, 'time_entries').where({ entry_id: lateEntry.entry_id }).first() as any).invoiced).toBe(true);
    expect(await late(fixture.clientId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('refuses silently omitting late time on a terminated contract: it is named as unbillable with the closed period', async () => {
    const fixture = await seedHourlyClient();
    await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 60);
    const january = await generateInvoice(fixture.cycleIds.january);
    const lateEntry = await logApprovedHours(fixture, '2024-12-22T10:00:00Z', 45);
    expect((await late(fixture.clientId))[0]).toMatchObject({ entryId: lateEntry.entry_id, disposition: 'next_invoice' });

    const clientContract = await tenantTable(db, tenantId, 'client_contracts').where({ client_id: fixture.clientId }).first() as any;
    const terminated = await updateClientContractForBilling(clientContract.client_contract_id, { is_active: false } as any);
    expect((terminated as any)?.actionError ?? null).toBeNull();

    const notices = await late(fixture.clientId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      entryId: lateEntry.entry_id, disposition: 'no_later_period', clientName: expect.stringContaining('Late Time Client'),
      contractLineName: expect.any(String), serviceName: 'Late Remote Support', closedPeriodStart: '2024-12-01',
      closedPeriodEnd: '2024-12-31', closedByInvoiceNumber: (january as any).invoice_number, billableMinutes: 45,
    });
    // Nothing billed it: the entry is still approved, uninvoiced, and named.
    const row = await tenantTable(db, tenantId, 'time_entries').where({ entry_id: lateEntry.entry_id }).first() as any;
    expect(row).toMatchObject({ invoiced: false, approval_status: 'APPROVED' });
  }, HOOK_TIMEOUT);

  it('a voided invoice keeps its window closed: regeneration is refused, so late time carries forward and is named', async () => {
    const { finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    const { voidInvoice } = await import('@alga-psa/billing/actions/voidInvoiceActions');
    const fixture = await seedHourlyClient();
    await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 60);
    const january = await generateInvoice(fixture.cycleIds.january) as any;
    expect((await finalizeInvoice(january.invoice_id) as any)?.actionError ?? null).toBeNull();
    const voided = await voidInvoice(january.invoice_id, 'late-time regression: void then check');
    expect(voided).toMatchObject({ success: true });
    expect((await tenantTable(db, tenantId, 'invoices').where({ invoice_id: january.invoice_id }).first() as any).status).toBe('cancelled');
    const dated = await logApprovedHours(fixture, '2024-12-23T10:00:00Z', 60);

    // The product will not regenerate the voided window ...
    // (pre-existing behaviour: the refusal surfaces as the period-claim guard's error)
    const again = await generateInvoice(fixture.cycleIds.january).catch((error: Error) => error) as any;
    expect(again?.invoice_id ?? null).toBeNull();
    expect(String(again?.message ?? again?.actionError ?? '')).toMatch(/already claimed|already exists/i);
    // ... so the late entry is named with the voided invoice and carries forward once.
    const notices = await late(fixture.clientId);
    expect(notices).toEqual([expect.objectContaining({ entryId: dated.entry_id, disposition: 'next_invoice', closedByInvoiceStatus: 'cancelled' })]);
    const february = await generateInvoice(fixture.cycleIds.february) as any;
    const links = await tenantTable(db, tenantId, 'invoice_time_entries').where({ invoice_id: february.invoice_id }).select('entry_id');
    expect(links.map((l: any) => l.entry_id)).toContain(dated.entry_id);
    expect(await late(fixture.clientId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('a reversed draft releases its window: late time rejoins the regenerated window and is not carried as late time', async () => {
    const { hardDeleteInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    const fixture = await seedHourlyClient();
    const onTime = await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 60);
    const january = await generateInvoice(fixture.cycleIds.january) as any;
    const dated = await logApprovedHours(fixture, '2024-12-23T10:00:00Z', 60);
    expect((await late(fixture.clientId)).map((n) => n.entryId)).toEqual([dated.entry_id]);
    expect((await hardDeleteInvoice(january.invoice_id) as any)?.actionError ?? null).toBeNull();
    // Negative control: once the draft is reversed nothing is late any more.
    expect(await late(fixture.clientId)).toEqual([]);
    const regenerated = await generateInvoice(fixture.cycleIds.january) as any;
    expect(regenerated?.invoice_id).toBeDefined();
    const rows = await tenantTable(db, tenantId, 'invoice_time_entries as ite')
      .join('invoice_charges as ic', function () { this.on('ic.item_id', '=', 'ite.item_id').andOn('ic.tenant', '=', 'ite.tenant'); })
      .where('ite.invoice_id', regenerated.invoice_id).select('ite.entry_id', 'ic.description');
    expect(rows.map((r: any) => r.entry_id).sort()).toEqual([onTime.entry_id, dated.entry_id].sort());
    expect(rows.every((r: any) => !String(r.description).includes('late time'))).toBe(true);
    const february = await generateInvoice(fixture.cycleIds.february) as any;
    const febLinks = february?.invoice_id ? await tenantTable(db, tenantId, 'invoice_time_entries').where({ invoice_id: february.invoice_id }).select('entry_id') : [];
    expect(febLinks.map((l: any) => l.entry_id)).not.toContain(dated.entry_id);
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

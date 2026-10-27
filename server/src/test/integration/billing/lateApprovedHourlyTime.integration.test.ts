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
let getLateApprovedHourlyTime: typeof import('@alga-psa/billing/actions/billingAndTax').getLateApprovedHourlyTime;
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

async function seedHourlyClient(contractStart = '2024-12-01'): Promise<Fixture> {
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
    default_rate: HOURLY_RATE_CENTS,
    unit_of_measure: 'hour',
    billing_method: 'per_unit',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });
  // Catalog price equals the contract rate: rate precedence is main's existing
  // resolution and not what this suite exercises; the amounts below are exact.
  await tenantTable(db, tenantId, 'service_prices').insert({
    tenant: tenantId,
    service_id: serviceId,
    currency_code: 'USD',
    rate: HOURLY_RATE_CENTS,
  });

  const wizardResult = await createClientContractFromWizard({
    contract_name: 'Late Hourly Support',
    description: 'hourly late-time contract',
    client_id: clientId,
    start_date: contractStart,
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
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ getLateApprovedHourlyTime } = await import('@alga-psa/billing/actions/billingAndTax'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  const LATE_SUFFIX = /\(late time, service period 2024-12-01–2024-12-31\)/;

  const late = async (clientId: string) => {
    const result = await getLateApprovedHourlyTime({ clientId });
    if (!Array.isArray(result)) throw new Error('permission error');
    return result;
  };

  async function lineFor(invoiceId: string, entryId: string) {
    const link = await tenantTable(db, tenantId, 'invoice_time_entries').where({ invoice_id: invoiceId, entry_id: entryId }).first();
    expect(link).toBeDefined();
    return (await tenantTable(db, tenantId, 'invoice_charges').where({ item_id: (link as any).item_id }).first()) as any;
  }

  async function issueDecember(fixture: Fixture, finalize: boolean) {
    const { finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    await logApprovedHours(fixture, '2024-12-10T10:00:00Z', 120);
    const january = (await generateInvoice(fixture.cycleIds.january)) as any;
    expect(january?.actionError).toBeUndefined();
    expect(Number(january.subtotal)).toBe(2 * HOURLY_RATE_CENTS);
    if (finalize) {
      expect(((await finalizeInvoice(january.invoice_id)) as any)?.actionError ?? null).toBeNull();
    }
    return january;
  }

  it('bills late time dated in an issued period once on the next invoice, at the exact amount, with the late suffix', async () => {
    const fixture = await seedHourlyClient();
    const january = await issueDecember(fixture, true);
    const januaryBefore = await invoiceSnapshot(january.invoice_id);
    const lateEntry = await logApprovedHours(fixture, '2024-12-20T10:00:00Z', 60);
    const current = await logApprovedHours(fixture, '2025-01-15T10:00:00Z', 60);

    const notices = await late(fixture.clientId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      entryId: lateEntry.entry_id, disposition: 'next_invoice', closedPeriodStart: '2024-12-01',
      closedPeriodEnd: '2024-12-31', closedByInvoiceNumber: january.invoice_number, billableMinutes: 60,
      serviceName: 'Late Remote Support',
    });

    const february = (await generateInvoice(fixture.cycleIds.february)) as any;
    expect(february?.actionError).toBeUndefined();
    const snapshot = await invoiceSnapshot(february.invoice_id);
    expect(snapshot.links.sort()).toEqual([lateEntry.entry_id, current.entry_id].sort());
    expect(snapshot.subtotal).toBe(2 * HOURLY_RATE_CENTS);

    const lateLine = await lineFor(february.invoice_id, lateEntry.entry_id);
    expect(Number(lateLine.net_amount)).toBe(HOURLY_RATE_CENTS);
    expect(String(lateLine.description)).toMatch(LATE_SUFFIX);
    const currentLine = await lineFor(february.invoice_id, current.entry_id);
    expect(Number(currentLine.net_amount)).toBe(HOURLY_RATE_CENTS);
    expect(String(currentLine.description)).not.toMatch(/late time/);

    expect(await invoiceSnapshot(january.invoice_id)).toEqual(januaryBefore);
    expect(await late(fixture.clientId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('bills time in a voided window once as ordinary time, with no late suffix', async () => {
    const { voidInvoice } = await import('@alga-psa/billing/actions/voidInvoiceActions');
    const fixture = await seedHourlyClient();
    const january = await issueDecember(fixture, true);
    expect(await voidInvoice(january.invoice_id, 'voided window test')).toMatchObject({ success: true });
    const entry = await logApprovedHours(fixture, '2024-12-23T10:00:00Z', 60);

    expect(await late(fixture.clientId)).toEqual([]);
    const february = (await generateInvoice(fixture.cycleIds.february)) as any;
    expect(february?.actionError).toBeUndefined();
    const snapshot = await invoiceSnapshot(february.invoice_id);
    expect(snapshot.links).toEqual([entry.entry_id]);
    expect(snapshot.subtotal).toBe(HOURLY_RATE_CENTS);
    const line = await lineFor(february.invoice_id, entry.entry_id);
    expect(Number(line.net_amount)).toBe(HOURLY_RATE_CENTS);
    expect(String(line.description)).not.toMatch(/late time/);
  }, HOOK_TIMEOUT);

  it('bills time in a cancelled window once as ordinary time, with no late suffix', async () => {
    const fixture = await seedHourlyClient();
    const january = await issueDecember(fixture, false);
    await tenantTable(db, tenantId, 'invoices').where({ invoice_id: january.invoice_id }).update({ status: 'cancelled' });
    const entry = await logApprovedHours(fixture, '2024-12-23T10:00:00Z', 90);

    expect(await late(fixture.clientId)).toEqual([]);
    const february = (await generateInvoice(fixture.cycleIds.february)) as any;
    expect(february?.actionError).toBeUndefined();
    const snapshot = await invoiceSnapshot(february.invoice_id);
    expect(snapshot.links).toEqual([entry.entry_id]);
    expect(snapshot.subtotal).toBe(Math.round(1.5 * HOURLY_RATE_CENTS));
    const line = await lineFor(february.invoice_id, entry.entry_id);
    expect(String(line.description)).not.toMatch(/late time/);
  }, HOOK_TIMEOUT);

  it('does not bill time older than the 90-day lookback and reports it as outside lookback', async () => {
    const fixture = await seedHourlyClient('2024-09-01');
    const january = await issueDecember(fixture, true);
    // September to November were invoiced earlier by the same issued invoice's run.
    await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ obligation_id: fixture.contractLineId })
      .whereIn('service_period_start', ['2024-09-01', '2024-10-01', '2024-11-01'])
      .whereNotIn('lifecycle_state', ['superseded', 'archived'])
      .update({ invoice_id: january.invoice_id, invoice_linked_at: db.fn.now(), lifecycle_state: 'billed' });
    const old = await logApprovedHours(fixture, '2024-09-15T10:00:00Z', 60); // before the 2024-11-03 cutoff
    const inside = await logApprovedHours(fixture, '2024-12-20T10:00:00Z', 60);

    const notices = await late(fixture.clientId);
    expect(notices.find((n) => n.entryId === old.entry_id)).toMatchObject({
      disposition: 'outside_lookback', closedPeriodStart: '2024-09-01', closedPeriodEnd: '2024-09-30',
    });
    expect(notices.find((n) => n.entryId === inside.entry_id)).toMatchObject({ disposition: 'next_invoice' });

    const february = (await generateInvoice(fixture.cycleIds.february)) as any;
    const snapshot = await invoiceSnapshot(february.invoice_id);
    expect(snapshot.links).toEqual([inside.entry_id]);
    expect(snapshot.subtotal).toBe(HOURLY_RATE_CENTS);
    const oldRow = await tenantTable(db, tenantId, 'time_entries').where({ entry_id: old.entry_id }).first();
    expect((oldRow as any).invoiced).toBe(false);
  }, HOOK_TIMEOUT);

  it('a second generation run adds no late line and leaves the total unchanged', async () => {
    const fixture = await seedHourlyClient();
    await issueDecember(fixture, true);
    const lateEntry = await logApprovedHours(fixture, '2024-12-20T10:00:00Z', 60);
    const february = (await generateInvoice(fixture.cycleIds.february)) as any;
    const after = await invoiceSnapshot(february.invoice_id);
    expect(after.links).toEqual([lateEntry.entry_id]);
    expect(after.subtotal).toBe(HOURLY_RATE_CENTS);

    await generateInvoice(fixture.cycleIds.february).catch(() => undefined);
    expect(await invoiceSnapshot(february.invoice_id)).toEqual(after);
    const taken = await tenantTable(db, tenantId, 'invoice_time_entries').where({ entry_id: lateEntry.entry_id }).select('invoice_id');
    expect(taken).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it("scopes late time and the Automatic Invoices preview to the requested client: client B's entries never appear in client A's", async () => {
    const { getAvailableRecurringDueWork } = await import('@alga-psa/billing/actions/billingAndTax');
    const clientA = await seedHourlyClient();
    const clientB = await seedHourlyClient();
    await issueDecember(clientA, true);
    await issueDecember(clientB, true);
    const lateA = await logApprovedHours(clientA, '2024-12-20T10:00:00Z', 60);
    const lateB = await logApprovedHours(clientB, '2024-12-20T10:00:00Z', 60);
    // Approved, uninvoiced hourly time on a service no contract covers: the unresolved
    // (non-contract) time the Automatic Invoices scan in filterBillingPeriodsWithPotentialUnresolvedWork reads.
    const adHocServiceId = uuidv4();
    const { custom_service_type_id } = (await tenantTable(db, tenantId, 'service_catalog')
      .where({ service_id: clientA.serviceId }).first()) as any;
    await tenantTable(db, tenantId, 'service_catalog').insert({
      tenant: tenantId,
      service_id: adHocServiceId,
      service_name: 'Ad-hoc Support',
      description: 'hourly service on no contract',
      default_rate: HOURLY_RATE_CENTS,
      unit_of_measure: 'hour',
      billing_method: 'per_unit',
      custom_service_type_id,
      tax_rate_id: null,
      category_id: null,
    });
    await tenantTable(db, tenantId, 'service_prices').insert({
      tenant: tenantId, service_id: adHocServiceId, currency_code: 'USD', rate: HOURLY_RATE_CENTS,
    });
    const unresolved = async (fixture: Fixture) => createTestTimeEntry(db, tenantId, {
      work_item_id: fixture.ticketId,
      work_item_type: 'ticket',
      service_id: adHocServiceId,
      user_id: fixture.techId,
      start_time: new Date('2025-02-10T10:00:00Z'),
      end_time: new Date('2025-02-10T11:00:00Z'),
      billable_duration: 60,
      approval_status: 'APPROVED',
      tax_region: 'US-NY',
    });
    const unresolvedA = await unresolved(clientA);
    const unresolvedB = await unresolved(clientB);

    const lateIdsForA = (await late(clientA.clientId)).map((notice) => notice.entryId);
    expect(lateIdsForA).toContain(lateA.entry_id);
    expect(lateIdsForA).not.toContain(lateB.entry_id);

    const clientAName = ((await tenantTable(db, tenantId, 'clients').where({ client_id: clientA.clientId }).first()) as any).client_name;
    const preview = (await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 100,
      dateRange: { from: '2025-01-01', to: '2025-03-01' },
      clientName: clientAName,
    })) as any;
    expect(preview?.actionError).toBeUndefined();
    const previewRecordIds: string[] = (preview.invoiceCandidates ?? []).flatMap((candidate: any) =>
      (candidate.members ?? []).map((member: any) => String(member.recordId ?? '')),
    );
    expect(previewRecordIds).toContain(`unresolved:time:${unresolvedA.entry_id}`);
    expect(previewRecordIds).not.toContain(`unresolved:time:${unresolvedB.entry_id}`);
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


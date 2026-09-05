import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from './_dbTestUtils';

// Real-database regression test for the month-end-close hydration bug. The
// recurring_service_periods date columns are stored as postgres `date` and come
// back from the driver as JavaScript `Date` objects; fetchClientCadenceServicePeriodForMonthEndClose
// must normalize those before the shared policy parses them. Earlier action
// tests handed the fetch a stringified row fixture, so the Date branch of
// normalizeWindowDate was never exercised. This suite seeds a real row and lets
// pg hydrate it for real, mirroring what the live Generate month-end invoice
// confirmation does.
const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  hasPermissionAsync: vi.fn(async () => true),
  generateInvoiceForSelectionInputs: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  localizeActionError: vi.fn(async (result: unknown) => result),
}));

vi.mock('../lib/authHelpers', () => ({
  getCurrentUserAsync: mocks.getCurrentUserAsync,
  hasPermissionAsync: mocks.hasPermissionAsync,
}));

vi.mock('./invoiceGeneration', () => ({
  generateInvoiceForSelectionInput: vi.fn(),
  generateInvoiceForSelectionInputs: mocks.generateInvoiceForSelectionInputs,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    localizeActionError: mocks.localizeActionError,
  };
});

const { generateCalendarMonthEndCloseInvoices } = await import(
  './recurringBillingRunActions'
);

const TENANT = uuidv4();
const CLIENT_ID = uuidv4();
const CONTRACT_ID = uuidv4();
const CONTRACT_LINE_ID = uuidv4();
const SCHEDULE_KEY = `schedule:${TENANT}:client_contract_line:${CONTRACT_LINE_ID}:client:arrears`;
const PERIOD_KEY = 'period:2026-09-01:2026-10-01';
// A calendar-month arrears period [2026-09-01, 2026-10-01) closes at month end
// on 2026-09-30; its invoice window opens 2026-10-01 (service_period_end).
const SERVICE_PERIOD_START = '2026-09-01';
const SERVICE_PERIOD_END = '2026-10-01';
const WINDOW_START = '2026-10-01';
const WINDOW_END = '2026-11-01';

let db: Knex;

async function insertContractLineFixture(params: {
  contractLineId: string;
  billingTiming: 'arrears' | 'advance';
  name: string;
}): Promise<void> {
  await db('contract_lines').insert({
    tenant: TENANT,
    contract_line_id: params.contractLineId,
    contract_id: CONTRACT_ID,
    contract_line_name: params.name,
    billing_frequency: 'monthly',
    billing_timing: params.billingTiming,
    cadence_owner: 'client',
    is_template: false,
    is_active: true,
  });
}

async function insertServicePeriodFixture(overrides: {
  scheduleKey?: string;
  periodKey?: string;
  obligationId?: string;
  duePosition?: 'arrears' | 'advance';
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
} = {}): Promise<void> {
  await db('recurring_service_periods').insert({
    tenant: TENANT,
    schedule_key: overrides.scheduleKey ?? SCHEDULE_KEY,
    period_key: overrides.periodKey ?? PERIOD_KEY,
    revision: 1,
    obligation_id: overrides.obligationId ?? CONTRACT_LINE_ID,
    obligation_type: 'client_contract_line',
    charge_family: 'fixed',
    cadence_owner: 'client',
    due_position: overrides.duePosition ?? 'arrears',
    lifecycle_state: 'generated',
    service_period_start: overrides.servicePeriodStart ?? SERVICE_PERIOD_START,
    service_period_end: overrides.servicePeriodEnd ?? SERVICE_PERIOD_END,
    invoice_window_start: WINDOW_START,
    invoice_window_end: WINDOW_END,
    provenance_kind: 'generated',
    source_rule_version: '1.0.0',
  });
}

function buildGroupedTarget(selectorOverrides: Array<{ scheduleKey: string; periodKey: string }> = []) {
  const selectorInputs = [
    buildClientCadenceDueSelectionInput({
      clientId: CLIENT_ID,
      scheduleKey: SCHEDULE_KEY,
      periodKey: PERIOD_KEY,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    }),
    ...selectorOverrides.map((override) =>
      buildClientCadenceDueSelectionInput({
        clientId: CLIENT_ID,
        scheduleKey: override.scheduleKey,
        periodKey: override.periodKey,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
    ),
  ];
  return { groupKey: `g1:${WINDOW_START}`, selectorInputs };
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: TENANT,
    client_name: 'Month End Close Hydration Test',
    email: `month-end-close-${TENANT.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  // The month-end close validates the CANONICAL window: rows resolve to the
  // client through contract_lines -> contracts -> clients, and active-line
  // materialization is read from client_contracts. Seed the full chain.
  await db('clients').insert({
    tenant: TENANT,
    client_id: CLIENT_ID,
    client_name: 'Month End Close Client',
  });
  await db('contracts').insert({
    tenant: TENANT,
    contract_id: CONTRACT_ID,
    contract_name: 'Month End Close Contract',
    owner_client_id: CLIENT_ID,
  });
  await insertContractLineFixture({
    contractLineId: CONTRACT_LINE_ID,
    billingTiming: 'arrears',
    name: 'Month End Close Arrears Line',
  });
  await db('client_contracts').insert({
    tenant: TENANT,
    client_id: CLIENT_ID,
    contract_id: CONTRACT_ID,
    start_date: '2026-01-01',
    is_active: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1', tenant: TENANT });
  mocks.hasPermissionAsync.mockResolvedValue(true);
  mocks.generateInvoiceForSelectionInputs.mockResolvedValue({ invoice_id: `invoice-${uuidv4()}` });
});

afterEach(async () => {
  vi.useRealTimers();
  await db('recurring_service_periods').where({ tenant: TENANT }).del();
  // Per-test extra lines; the shared arrears line from beforeAll stays.
  await db('contract_lines')
    .where({ tenant: TENANT })
    .whereNot({ contract_line_id: CONTRACT_LINE_ID })
    .del();
});

afterAll(async () => {
  await db('recurring_service_periods').where({ tenant: TENANT }).del();
  await db('client_contracts').where({ tenant: TENANT }).del();
  await db('contract_lines').where({ tenant: TENANT }).del();
  await db('contracts').where({ tenant: TENANT }).del();
  await db('clients').where({ tenant: TENANT }).del();
  await db('tenants').where({ tenant: TENANT }).del();
  await db.destroy().catch(() => undefined);
  vi.useRealTimers();
});

describe('generateCalendarMonthEndCloseInvoices (DB-backed hydration)', () => {
  it('generates a month-end arrears invoice from pg-hydrated Date columns on the final calendar day', async () => {
    await insertServicePeriodFixture();

    // Prove the fixture hydrates the way production does: the pg driver returns
    // the postgres `date` columns as Date objects, never date-only strings. If
    // this ever stops being true the regression below silently loses its teeth.
    const seeded = await db('recurring_service_periods')
      .where({ tenant: TENANT, schedule_key: SCHEDULE_KEY })
      .first();
    expect(seeded).toBeDefined();
    expect(seeded.service_period_start).toBeInstanceOf(Date);
    expect(seeded.service_period_end).toBeInstanceOf(Date);
    expect(seeded.invoice_window_start).toBeInstanceOf(Date);
    expect(String(seeded.service_period_start)).not.toMatch(/^\d{4}-\d{2}-\d{2}/);

    // Freeze only the clock: the billing-calendar "today" must read the final
    // calendar day (2026-09-30) in the tenant's effective timezone (UTC for a
    // fresh tenant). Real I/O timers stay live so the DB round-trip completes.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    expect(result).toMatchObject({ invoicesCreated: 1, failedCount: 0, failures: [] });
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(1);
    // The eligible Date-hydrated row must thread the tenant-local final calendar
    // day as the invoiceDate override.
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ invoiceDate: '2026-09-30' }),
    );
  });

  it('rejects a pre-final-day direct invocation even when the row hydrates as Dates', async () => {
    await insertServicePeriodFixture();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    // The guard must still hold on the real hydrated row: not yet the final
    // calendar day, so no generation is attempted and no invoice is produced.
    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('refuses the close when an active line has no materialized period for the window', async () => {
    await insertServicePeriodFixture();
    // A second ACTIVE client-cadence line whose schedule change was never
    // rebuilt: no recurring_service_periods row for the window. Generation's
    // normalization refuses such windows, so the close must refuse too — the
    // listing-side flag reuses the exact same helper.
    await insertContractLineFixture({
      contractLineId: uuidv4(),
      billingTiming: 'arrears',
      name: 'Month End Close Unrebuilt Line',
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotMaterialized',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('refuses the close when the canonical window also serves an advance period', async () => {
    await insertServicePeriodFixture();
    // An ADVANCE line due in the same invoice window (October billed at period
    // start). Closing the window with only the arrears selection would strand
    // the advance period behind the window's duplicate guard, so the whole
    // window is ineligible — regardless of what the caller selected.
    const advanceLineId = uuidv4();
    await insertContractLineFixture({
      contractLineId: advanceLineId,
      billingTiming: 'advance',
      name: 'Month End Close Advance Line',
    });
    await insertServicePeriodFixture({
      scheduleKey: `schedule:${TENANT}:client_contract_line:${advanceLineId}:client:advance`,
      periodKey: 'period:2026-10-01:2026-11-01',
      obligationId: advanceLineId,
      duePosition: 'advance',
      servicePeriodStart: '2026-10-01',
      servicePeriodEnd: '2026-11-01',
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('refuses a partial selection of an otherwise eligible window', async () => {
    await insertServicePeriodFixture();
    // A second eligible arrears line in the same window that the caller did
    // NOT select. Generating only part of the canonical window would claim
    // the window's invoice identity and strand the unselected period.
    const secondArrearsLineId = uuidv4();
    const secondScheduleKey = `schedule:${TENANT}:client_contract_line:${secondArrearsLineId}:client:arrears`;
    await insertContractLineFixture({
      contractLineId: secondArrearsLineId,
      billingTiming: 'arrears',
      name: 'Month End Close Second Arrears Line',
    });
    await insertServicePeriodFixture({
      scheduleKey: secondScheduleKey,
      obligationId: secondArrearsLineId,
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

    const partialSelection = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    expect(partialSelection).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();

    // The complete selection of the same window generates normally.
    const completeSelection = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        buildGroupedTarget([{ scheduleKey: secondScheduleKey, periodKey: PERIOD_KEY }]),
      ],
    });

    expect(completeSelection).toMatchObject({ invoicesCreated: 1, failedCount: 0 });
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(1);
  });

  it('surfaces a repeated close as duplicateRecurringInvoice', async () => {
    await insertServicePeriodFixture();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

    // Production generation refuses an already-claimed window with the coded
    // duplicate error before creating anything; the manual close must surface
    // it (the scheduled run treats it as a benign skip instead).
    const duplicateError = Object.assign(
      new Error('Invoice already exists for this recurring execution window'),
      { code: 'DUPLICATE_RECURRING_INVOICE' },
    );
    mocks.generateInvoiceForSelectionInputs.mockRejectedValueOnce(duplicateError);

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [buildGroupedTarget()],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.duplicateRecurringInvoice',
    });
  });
});

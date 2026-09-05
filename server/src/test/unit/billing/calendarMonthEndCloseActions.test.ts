import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  DUPLICATE_RECURRING_INVOICE_CODE,
  DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
} from '../../../../../packages/billing/src/actions/invoiceGeneration.constants';

const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  hasPermissionAsync: vi.fn(async () => true),
  generateInvoiceForSelectionInputs: vi.fn(),
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(
    async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => cb({}),
  ),
  resolveEffectiveTimeZone: vi.fn(async () => 'UTC'),
  localizeActionError: vi.fn(async (result: unknown) => result),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getCurrentUserAsync: mocks.getCurrentUserAsync,
  hasPermissionAsync: mocks.hasPermissionAsync,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceForSelectionInput: vi.fn(),
  generateInvoiceForSelectionInputs: mocks.generateInvoiceForSelectionInputs,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
  withTransaction: mocks.withTransaction,
  resolveEffectiveTimeZone: mocks.resolveEffectiveTimeZone,
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    localizeActionError: mocks.localizeActionError,
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

const { generateCalendarMonthEndCloseInvoices } = await import(
  '../../../../../packages/billing/src/actions/recurringBillingRunActions'
);

const TENANT = 'tenant-1';
const USER = { user_id: 'user-1', tenant: TENANT };
const SCHEDULE_KEY = 'schedule:tenant-1:client_contract_line:line-1:client:arrears';
const PERIOD_KEY = 'period:2026-06-01:2026-07-01';

interface ServicePeriodRowFixture {
  service_period_start: string;
  service_period_end: string;
  invoice_window_start: string;
  due_position: 'arrears' | 'advance';
}

/**
 * The canonical recurring_service_periods row the materialization helper
 * selects, carrying the same (schedule, period) identity as the selector
 * inputs built by buildClientCadenceTarget so the action's selection
 * completeness checks see a fully-selected window.
 */
function toCanonicalRow(row: ServicePeriodRowFixture) {
  return {
    schedule_key: SCHEDULE_KEY,
    period_key: PERIOD_KEY,
    due_position: row.due_position,
    service_period_start: row.service_period_start,
    service_period_end: row.service_period_end,
    invoice_window_start: row.invoice_window_start,
  };
}

/**
 * Query-builder mock for the canonical window materialization helpers
 * (listCanonicalClientCadenceWindowPeriods /
 * listUnmaterializedClientCadenceWindowLineIds), which run inside
 * withTransaction and terminate their chains with `.select()`:
 * - `client_contracts as cc` (active recurring lines) resolves to no rows,
 *   so no line is ever reported unmaterialized by that path;
 * - `recurring_service_periods` resolves the fixture row keyed by the
 *   `invoice_window_start` where-clause, so a run can carry both an eligible
 *   and an ineligible group. Unknown windows materialize as nothing.
 */
function makeCanonicalWindowQueryBuilder(
  tableName: string,
  rowsByWindow: Record<string, ServicePeriodRowFixture | null>,
) {
  const whereClause: Record<string, unknown> = {};
  const builder: any = {
    where: vi.fn((arg: unknown) => {
      if (arg && typeof arg === 'object') {
        Object.assign(whereClause, arg as Record<string, unknown>);
      }
      return builder;
    }),
    whereIn: vi.fn(() => builder),
    whereNotIn: vi.fn(() => builder),
    whereNotNull: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    select: vi.fn(async () => {
      if (tableName.startsWith('client_contracts')) {
        return [];
      }
      const windowStart =
        whereClause['rsp.invoice_window_start'] ?? whereClause['invoice_window_start'];
      const row = typeof windowStart === 'string' ? rowsByWindow[windowStart] : undefined;
      return row ? [toCanonicalRow(row)] : [];
    }),
  };
  return builder;
}

function installDbRowsByInvoiceWindow(
  rowsByWindow: Record<string, ServicePeriodRowFixture | null>,
) {
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
  mocks.tenantDb.mockImplementation(() => ({
    table: vi.fn((tableName: string) =>
      makeCanonicalWindowQueryBuilder(tableName, rowsByWindow),
    ),
    tenantJoin: vi.fn(),
  }));
}

function installDbRow(row: ServicePeriodRowFixture | null) {
  installDbRowsByInvoiceWindow(row ? { [row.invoice_window_start]: row } : {});
}

function buildClientCadenceTarget(windowStart: string, windowEnd: string) {
  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: 'client-1',
    scheduleKey: SCHEDULE_KEY,
    periodKey: PERIOD_KEY,
    windowStart,
    windowEnd,
  });
  return selectorInput;
}

describe('generateCalendarMonthEndCloseInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.getCurrentUserAsync.mockResolvedValue(USER);
    mocks.hasPermissionAsync.mockResolvedValue(true);
    mocks.generateInvoiceForSelectionInputs.mockResolvedValue({ invoice_id: 'invoice-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a caller without invoice create/generate permission', async () => {
    mocks.hasPermissionAsync.mockResolvedValue(false);

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.invoicePermission',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('generates a calendar-month arrears invoice on the final calendar day in the billing timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T22:30:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('Pacific/Honolulu'); // still 2026-06-30 locally
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({ invoicesCreated: 1, failedCount: 0, failures: [] });
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(1);
    // The invoice date must be the tenant-local final calendar day, threaded as
    // the explicit invoiceDate override, never the server host's calendar date.
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ invoiceDate: '2026-06-30' }),
    );
  });

  it('stamps the tenant-local final calendar day when the billing timezone and UTC disagree', async () => {
    // 2026-01-30T22:00Z is already 2026-01-31T09:00 AEDT in Australia/Sydney —
    // the final calendar day of the January period — but still 2026-01-30 in UTC.
    // The eligibility gate approves (Sydney) and the invoice must be dated
    // 2026-01-31, not the server-local 2026-01-30.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-30T22:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('Australia/Sydney');
    installDbRow({
      service_period_start: '2026-01-01',
      service_period_end: '2026-02-01',
      invoice_window_start: '2026-02-01',
      due_position: 'arrears',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-02-01', '2026-03-01')] },
      ],
    });

    expect(result).toMatchObject({ invoicesCreated: 1, failedCount: 0, failures: [] });
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ invoiceDate: '2026-01-31' }),
    );
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.not.objectContaining({ invoiceDate: '2026-01-30' }),
    );
  });

  it('rejects the same instant where the billing timezone has already rolled to the 1st', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T22:30:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('Europe/Berlin'); // already 2026-07-01 locally
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('rejects direct invocation before the final calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });

  it('rejects advance-billed periods', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'advance',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
  });

  it('rejects anchored service periods that are not calendar months', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-10',
      service_period_end: '2026-07-10',
      invoice_window_start: '2026-07-10',
      due_position: 'arrears',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-10', '2026-08-10')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
  });

  it('surfaces an already-invoiced duplicate instead of silently succeeding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });
    mocks.generateInvoiceForSelectionInputs.mockResolvedValue({
      actionError: 'Invoice already exists for this recurring execution window.',
      messageKey: DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
      messageParams: {},
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({ messageKey: DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY });
  });

  it('also catches a thrown duplicate coded error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });
    mocks.generateInvoiceForSelectionInputs.mockRejectedValue({
      code: DUPLICATE_RECURRING_INVOICE_CODE,
      message: 'Invoice already exists for this recurring execution window.',
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({ messageKey: DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY });
  });

  it('forwards a returned generation error (e.g. missing approvals) rather than generating', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow({
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      due_position: 'arrears',
    });
    mocks.generateInvoiceForSelectionInputs.mockResolvedValue({
      actionError: 'Blocked until approval: 2 unapproved entries.',
      messageKey: 'msp/billing:errors.recurringServicePeriod.approvalBlocked',
      messageParams: { count: '2' },
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({ messageKey: 'msp/billing:errors.recurringServicePeriod.approvalBlocked' });
  });

  it('rejects a group whose service period is not materialized', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRow(null);

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
      ],
    });

    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotMaterialized',
    });
  });

  it('pre-validates every target before generating any: one ineligible group blocks the whole run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
    installDbRowsByInvoiceWindow({
      '2026-07-01': {
        service_period_start: '2026-06-01',
        service_period_end: '2026-07-01',
        invoice_window_start: '2026-07-01',
        due_position: 'arrears',
      },
      '2026-07-10': {
        service_period_start: '2026-06-10',
        service_period_end: '2026-07-10',
        invoice_window_start: '2026-07-10',
        due_position: 'arrears',
      },
    });

    const result = await generateCalendarMonthEndCloseInvoices({
      groupedTargets: [
        { groupKey: 'g1', selectorInputs: [buildClientCadenceTarget('2026-07-01', '2026-08-01')] },
        { groupKey: 'g2', selectorInputs: [buildClientCadenceTarget('2026-07-10', '2026-08-10')] },
      ],
    });

    // The eligible group must not have been invoiced: validation of the second
    // (anchored, non-calendar-month) target fails before any generation starts.
    expect(result).toMatchObject({
      messageKey: 'msp/billing:errors.recurringRun.monthEndCloseNotEligible',
    });
    expect(mocks.generateInvoiceForSelectionInputs).not.toHaveBeenCalled();
  });
});

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

interface ServicePeriodRowFixture {
  service_period_start: string;
  service_period_end: string;
  invoice_window_start: string;
  due_position: 'arrears' | 'advance';
}

function installDbRow(row: ServicePeriodRowFixture | null) {
  const builder: any = {
    where: vi.fn(() => builder),
    whereIn: vi.fn(() => builder),
    whereNotIn: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    first: vi.fn(async () => (row ? { ...row } : undefined)),
  };
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
  mocks.tenantDb.mockReturnValue({ table: vi.fn(() => builder) });
}

function buildClientCadenceTarget(windowStart: string, windowEnd: string) {
  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: 'client-1',
    scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
    periodKey: 'period:2026-06-01:2026-07-01',
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
});

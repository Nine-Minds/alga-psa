// @vitest-environment jsdom

/**
 * Behavioral coverage for the Usage Tracking review findings, driven through
 * the real UsageTracking component:
 *
 *  1. The additive create carries a non-empty request_id so server-side replay
 *     protection can collapse double-clicks/network retries: an unchanged
 *     resubmission reuses the SAME id, while editing the form regenerates it so
 *     a changed submission is a genuinely new request.
 *  2. "Record Usage" deep links that carry service-period boundaries
 *     (initialPeriodStart/initialPeriodEnd, end exclusive) scope the records
 *     load to that period, surface a dismissible context note, and default the
 *     Add Usage date into the period when "today" falls outside it.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayUsageDate, usageDateToStored } from '../src/lib/usageDate';

const actionMocks = vi.hoisted(() => ({
  createUsageRecord: vi.fn(),
  upsertUsagePeriodTotal: vi.fn(),
  getUsagePeriodEntryContext: vi.fn(),
  push: vi.fn(),
  updateUsageRecord: vi.fn(),
  deleteUsageRecord: vi.fn(),
  getUsageRecords: vi.fn(),
  getEligibleContractLinesForUI: vi.fn(),
  getAllClientsForBilling: vi.fn(),
  getRemainingBucketUnits: vi.fn(),
}));

vi.mock('next/navigation', () => ({useRouter: () => ({push: actionMocks.push})}));
vi.mock('../src/actions/usagePeriodTotalActions', () => ({
  upsertUsagePeriodTotal: actionMocks.upsertUsagePeriodTotal,
  getUsagePeriodEntryContext: actionMocks.getUsagePeriodEntryContext,
}));
vi.mock('../src/actions/usageActions', () => ({
  createUsageRecord: actionMocks.createUsageRecord,
  updateUsageRecord: actionMocks.updateUsageRecord,
  deleteUsageRecord: actionMocks.deleteUsageRecord,
  getUsageRecords: actionMocks.getUsageRecords,
  getEligibleContractLinesForUI: actionMocks.getEligibleContractLinesForUI,
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: actionMocks.getAllClientsForBilling,
}));

vi.mock('@alga-psa/reporting/actions/report-actions/getRemainingBucketUnits', () => ({
  getRemainingBucketUnits: actionMocks.getRemainingBucketUnits,
}));

const translate = (_key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? _key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'action error',
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {} }),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, asChild: _a, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: any) => <div data-testid="date-picker">{String(value ?? '')}</div>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div role="dialog">
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options = [] }: any) => (
    <div data-testid={`custom-select-${id}`}>
      <span data-testid={`value-${id}`}>{value ?? ''}</span>
      {options.map((opt: any) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`option-${id}-${opt.value}`}
          onClick={() => onValueChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: any) => (
    <button type="button" data-testid="pick-client" onClick={() => onSelect('client-1')}>
      pick client
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: () => <div data-testid="usage-table" />,
}));

vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/charts/BucketUsageChart', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => null }));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: UsageTracking } = await import(
  '../src/components/billing-dashboard/UsageTracking'
);

const initialServices = [
  {
    service_id: 'svc-1',
    service_name: 'Managed Seats',
    item_kind: 'service',
  },
] as any;

const eligibleLines = [
  {
    client_contract_line_id: 'line-a',
    contract_line_name: 'Managed Seats',
    contract_line_type: 'Usage',
    contract_name: 'Good and Natural',
    start_date: '2026-01-01T00:00:00.000Z',
    end_date: null,
    has_bucket_overlay: false,
  },
];

/** Opens the Add Usage dialog and fills client + service so the form is submittable. */
async function openAndFillAddDialog() {
  fireEvent.click(await screen.findByRole('button', { name: /Add Usage/i }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByTestId('pick-client'));
  fireEvent.click(screen.getByTestId('option-service-select-svc-1'));
  // Wait for the single eligible line to auto-select so form state settles.
  await waitFor(() =>
    expect(screen.getByTestId('value-contract-line-select').textContent).toBe('line-a'),
  );
}

describe('UsageTracking add-usage request_id replay key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue([
      { client_id: 'client-1', client_name: 'Solutions by Swift' },
    ]);
    actionMocks.getUsageRecords.mockResolvedValue([]);
    actionMocks.getRemainingBucketUnits.mockResolvedValue([]);
    actionMocks.getEligibleContractLinesForUI.mockResolvedValue(eligibleLines);
    actionMocks.createUsageRecord.mockResolvedValue({
      usage_id: 'usage-new',
      client_id: 'client-1',
      service_id: 'svc-1',
      quantity: 5,
      usage_date: usageDateToStored(todayUsageDate()),
      contract_line_id: 'line-a',
    });
  });

  it('reuses the request_id for unchanged retries and regenerates it when content changes', async () => {
    // Keep the dialog open across resubmissions by failing the first two
    // attempts — the real retry scenario the replay key exists for.
    actionMocks.createUsageRecord
      .mockRejectedValueOnce(new Error('network drop'))
      .mockRejectedValueOnce(new Error('network drop'));

    render(<UsageTracking initialServices={initialServices} />);
    await openAndFillAddDialog();

    // First submit: payload carries a non-empty request_id.
    fireEvent.click(document.getElementById('submit-usage-button')!);
    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(1));
    const firstId = actionMocks.createUsageRecord.mock.calls[0][0].request_id;
    expect(typeof firstId).toBe('string');
    expect(firstId.length).toBeGreaterThan(0);

    // Second submit with the form untouched: identical retry, SAME id.
    fireEvent.click(document.getElementById('submit-usage-button')!);
    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(2));
    expect(actionMocks.createUsageRecord.mock.calls[1][0].request_id).toBe(firstId);

    // Change the quantity, then submit: a changed submission must be a fresh
    // request, not a replay of the failed one.
    fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '9' } });
    fireEvent.click(document.getElementById('submit-usage-button')!);
    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(3));
    const thirdCall = actionMocks.createUsageRecord.mock.calls[2][0];
    expect(thirdCall.quantity).toBe(9);
    expect(thirdCall.request_id).not.toBe(firstId);
    expect(thirdCall.request_id.length).toBeGreaterThan(0);
  });
});

describe('UsageTracking service-period deep-link context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue([
      { client_id: 'client-1', client_name: 'Solutions by Swift' },
    ]);
    actionMocks.getUsageRecords.mockResolvedValue([]);
    actionMocks.getRemainingBucketUnits.mockResolvedValue([]);
    actionMocks.getEligibleContractLinesForUI.mockResolvedValue(eligibleLines);
    actionMocks.createUsageRecord.mockResolvedValue({
      usage_id: 'usage-new',
      client_id: 'client-1',
      service_id: 'svc-1',
      quantity: 0,
      usage_date: usageDateToStored('2026-07-01'),
      contract_line_id: 'line-a',
    });
  });

  it('loads records scoped to [periodStart, periodEnd) and renders a clearable note', async () => {
    render(
      <UsageTracking
        initialServices={initialServices}
        initialPeriodStart="2026-07-01"
        initialPeriodEnd="2026-08-01"
      />,
    );

    // The records load carries the period: start at the period-start UTC
    // midnight, end strictly BEFORE the period-end UTC midnight (getUsageRecords
    // compares end_date inclusively, and entries dated on the period end belong
    // to the next period).
    await waitFor(() => expect(actionMocks.getUsageRecords).toHaveBeenCalled());
    const filteredCall = actionMocks.getUsageRecords.mock.calls.at(-1)![0];
    expect(filteredCall.start_date).toBe('2026-07-01T00:00:00.000Z');
    expect(filteredCall.end_date).toBe('2026-07-31T23:59:59.999Z');

    // The context note is visible and dismissible.
    expect(
      await screen.findByText(/Showing usage for the service period/),
    ).toBeTruthy();
    const callsBeforeClear = actionMocks.getUsageRecords.mock.calls.length;
    fireEvent.click(document.getElementById('usage-period-filter-clear-button')!);

    // Clearing removes the note and reloads without the period bounds.
    await waitFor(() =>
      expect(actionMocks.getUsageRecords.mock.calls.length).toBeGreaterThan(callsBeforeClear),
    );
    const unfilteredCall = actionMocks.getUsageRecords.mock.calls.at(-1)![0];
    expect(unfilteredCall.start_date).toBeUndefined();
    expect(unfilteredCall.end_date).toBeUndefined();
    expect(screen.queryByText(/Showing usage for the service period/)).toBeNull();
  });

  it('defaults the new record date to the period start when today is outside the period', async () => {
    // A period fixed far in the past keeps "today outside the period" true
    // whenever the test runs.
    render(
      <UsageTracking
        initialServices={initialServices}
        initialPeriodStart="2000-01-01"
        initialPeriodEnd="2000-02-01"
      />,
    );

    await openAndFillAddDialog();
    fireEvent.click(document.getElementById('submit-usage-button')!);

    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(1));
    expect(actionMocks.createUsageRecord.mock.calls[0][0].usage_date).toBe(
      usageDateToStored('2000-01-01'),
    );
  });

  it('keeps today as the default date when it falls inside the period', async () => {
    const today = todayUsageDate();
    render(
      <UsageTracking
        initialServices={initialServices}
        initialPeriodStart={today}
        initialPeriodEnd="2099-01-01"
      />,
    );

    await openAndFillAddDialog();
    fireEvent.click(document.getElementById('submit-usage-button')!);

    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(1));
    expect(actionMocks.createUsageRecord.mock.calls[0][0].usage_date).toBe(
      usageDateToStored(today),
    );
  });
});

describe('UsageTracking contextual period reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue([{client_id: 'client-1', client_name: 'Synthetic Client'}]);
    actionMocks.getUsageRecords.mockResolvedValue([]);
    actionMocks.getRemainingBucketUnits.mockResolvedValue([]);
    actionMocks.getEligibleContractLinesForUI.mockResolvedValue(eligibleLines);
    actionMocks.upsertUsagePeriodTotal.mockResolvedValue({total: {quantity: 12, revision: 3}});
  });
  it.each([null, {quantity: 10, revision: 2, lifecycle_state: 'recorded'}])('creates or corrects the selected August report with current identity: %j', async total => {
    actionMocks.getUsagePeriodEntryContext.mockResolvedValue({measurement_mode: 'period_total', total});
    render(<UsageTracking initialServices={initialServices} initialClientId="client-1" initialServiceId="svc-1"
      initialContractLineId="line-a" initialConfigId="config-a" initialPeriodStart="2026-08-01" initialPeriodEnd="2026-09-01" returnToPreview />);
    const input = await screen.findByRole('spinbutton', {name: 'Period count for Managed Seats'});
    expect((input as HTMLInputElement).value).toBe(total ? '10' : '');
    fireEvent.change(input, {target: {value: '12'}});
    fireEvent.click(document.getElementById('period-total-save-usage-tracking-context')!);
    await waitFor(() => expect(actionMocks.upsertUsagePeriodTotal).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-1', client_contract_line_id: 'line-a', service_id: 'svc-1', config_id: 'config-a',
      period_start: '2026-08-01', period_end: '2026-08-31', quantity: 12, request_id: expect.any(String),
      ...(total ? {expected_revision: 2} : {}),
    })));
    if (!total) expect(actionMocks.upsertUsagePeriodTotal.mock.calls[0][0]).not.toHaveProperty('expected_revision');
    expect(actionMocks.push).toHaveBeenCalledWith('/msp/billing?tab=invoicing&subtab=generate&resumeUsagePreview=1');
  });
});

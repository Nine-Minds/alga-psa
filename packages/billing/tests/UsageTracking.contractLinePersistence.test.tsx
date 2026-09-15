// @vitest-environment jsdom

/**
 * Behavioral coverage for the two smoke-proven "Add Usage" blockers, driven
 * through the real UsageTracking component:
 *
 *  1. Same-named eligible contract lines are distinguishable in the dropdown and
 *     the id the operator selects is the id that persists onto the created usage
 *     record (not silently collapsed to the first same-named line).
 *  2. The default usage_date is a canonical plain calendar day (UTC-midnight
 *     ISO), not a `new Date().toISOString()` wall-clock instant that can drift a
 *     day across the UTC boundary.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayUsageDate, usageDateToStored } from '../src/lib/usageDate';

const actionMocks = vi.hoisted(() => ({
  createUsageRecord: vi.fn(),
  updateUsageRecord: vi.fn(),
  deleteUsageRecord: vi.fn(),
  getUsageRecords: vi.fn(),
  getEligibleContractLinesForUI: vi.fn(),
  getAllClientsForBilling: vi.fn(),
  getRemainingBucketUnits: vi.fn(),
}));

vi.mock('next/navigation', () => ({useRouter: () => ({push: vi.fn()})}));
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

const sameNamedLines = [
  {
    client_contract_line_id: 'line-a',
    contract_line_name: 'Managed Seats',
    contract_line_type: 'Usage',
    contract_name: 'Good and Natural',
    start_date: '2026-07-17T00:00:00.000Z',
    end_date: null,
    has_bucket_overlay: false,
  },
  {
    client_contract_line_id: 'line-b',
    contract_line_name: 'Managed Seats',
    contract_line_type: 'Usage',
    contract_name: 'Emerald City Retainer',
    start_date: '2026-07-17T00:00:00.000Z',
    end_date: null,
    has_bucket_overlay: false,
  },
];

describe('UsageTracking add-usage: contract-line persistence and default date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue([
      { client_id: 'client-1', client_name: 'Solutions by Swift' },
    ]);
    actionMocks.getUsageRecords.mockResolvedValue([]);
    actionMocks.getRemainingBucketUnits.mockResolvedValue([]);
    actionMocks.getEligibleContractLinesForUI.mockResolvedValue(sameNamedLines);
    actionMocks.createUsageRecord.mockResolvedValue({
      usage_id: 'usage-new',
      client_id: 'client-1',
      service_id: 'svc-1',
      quantity: 5,
      usage_date: usageDateToStored(todayUsageDate()),
      contract_line_id: 'line-b',
    });
  });

  it('persists the operator-selected same-named contract line and a canonical default date', async () => {
    render(<UsageTracking initialServices={initialServices} />);

    // Open the Add Usage dialog.
    fireEvent.click(await screen.findByRole('button', { name: /Add Usage/i }));
    const dialog = await screen.findByRole('dialog');

    // Choose client + service so eligible contract lines load.
    fireEvent.click(screen.getByTestId('pick-client'));
    fireEvent.click(screen.getByTestId('option-service-select-svc-1'));

    // Both same-named lines must be offered as DISTINCT, contract-identified
    // options — proving disambiguation reached the dropdown.
    const optionA = await screen.findByTestId('option-contract-line-select-line-a');
    const optionB = await screen.findByTestId('option-contract-line-select-line-b');
    expect(optionA.textContent).toContain('Good and Natural');
    expect(optionB.textContent).toContain('Emerald City Retainer');
    expect(optionA.textContent).not.toBe(optionB.textContent);

    // Select the SECOND same-named line.
    fireEvent.click(optionB);
    await waitFor(() =>
      expect(screen.getByTestId('value-contract-line-select').textContent).toBe('line-b'),
    );

    // Submit (footer button is addressed by id to avoid the duplicate
    // "Add Usage" label shared with the header button).
    fireEvent.click(document.getElementById('submit-usage-button')!);

    await waitFor(() => expect(actionMocks.createUsageRecord).toHaveBeenCalledTimes(1));
    const payload = actionMocks.createUsageRecord.mock.calls[0][0];

    // The persisted contract line is the one the operator picked...
    expect(payload.contract_line_id).toBe('line-b');
    // ...and the default usage_date is the canonical plain-calendar-day form.
    expect(payload.usage_date).toBe(usageDateToStored(todayUsageDate()));
    expect(payload.usage_date).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  });
});

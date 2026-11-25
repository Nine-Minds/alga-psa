// @vitest-environment jsdom
//
// Defect 2: the quick-add dialog sent `startDate.toISOString().split('T')[0]`.
// A DatePicker hands over local midnight, so east of UTC that slice is the
// PREVIOUS day and the contract started (and ended) a day early.
//
// The zone is pinned east of UTC in-file, before any Date is built, so the
// shift this asserts against is the one a server in Auckland (or Berlin, or
// Tokyo) produces. The control assertion below proves the zone took effect.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = 'Pacific/Auckland';

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getClientByIdForBilling: vi.fn(),
  getContractLinePresets: vi.fn(),
  getContractLinePresetServiceCounts: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
  saveQuickAddContract: vi.fn(),
}));

/** Dates the mocked pickers hand over, in click order (start, then end). */
const picker = vi.hoisted(() => ({ queue: [] as Array<Date | undefined> }));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: actionMocks.getClientByIdForBilling,
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServiceCounts: actionMocks.getContractLinePresetServiceCounts,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  saveQuickAddContract: actionMocks.saveQuickAddContract,
}));

vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useContractLineTypeOptions: () => [{ value: 'Fixed', label: 'Fixed' }],
  useFormatContractLineType: () => (value?: string | null) => value ?? '',
  useFormatBillingFrequency: () => (value?: string | null) => value ?? '',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (value: number) => `$${(value / 100).toFixed(2)}`,
    symbol: () => '$',
  }),
}));

vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? <div data-testid="contract-dialog">{children}{footer}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string | null) => void }) => (
    <button type="button" data-testid="client-picker" onClick={() => onSelect('client-1')}>
      pick client
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({
  BillingProfilePicker: () => <div data-testid="billing-profile-picker" />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select" />,
}));

// The real picker hands over a local-midnight Date for the day the user clicked.
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ onChange }: { onChange: (date: Date | undefined) => void }) => (
    <button type="button" data-testid="date-picker" onClick={() => onChange(picker.queue.shift())}>
      pick date
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: () => <div data-testid="switch" />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: () => <div data-testid="checkbox" />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const { ContractDialog } = await import('../src/components/billing-dashboard/contracts/ContractDialog');

describe('ContractDialog dates east of UTC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getClientByIdForBilling.mockResolvedValue(
      { client_id: 'client-1', client_name: 'Emerald City', default_currency_code: 'USD' },
    );
    actionMocks.getContractLinePresets.mockResolvedValue([]);
    actionMocks.getContractLinePresetServiceCounts.mockResolvedValue({});
    actionMocks.saveQuickAddContract.mockResolvedValue({ contract_id: 'contract-1', contract_line_ids: [] });
  });
  afterEach(() => cleanup());
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('sends the picked calendar days, not the UTC-shifted ones', async () => {
    const pickedStart = new Date(2026, 3, 1);
    const pickedEnd = new Date(2026, 8, 30);
    // Control: this is the zone where the old read lost a day.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    expect(pickedStart.toISOString().split('T')[0]).toBe('2026-03-31');
    expect(pickedEnd.toISOString().split('T')[0]).toBe('2026-09-29');
    picker.queue = [pickedStart, pickedEnd];

    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);

    await screen.findByTestId('contract-dialog');
    fireEvent.change(document.getElementById('contract-name')!, { target: { value: 'Timezone Contract' } });
    fireEvent.click(screen.getByTestId('client-picker'));
    const pickers = screen.getAllByTestId('date-picker');
    fireEvent.click(pickers[0]);
    fireEvent.click(pickers[1]);

    fireEvent.submit(document.getElementById('contract-dialog-form')!);

    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
    expect(actionMocks.saveQuickAddContract.mock.calls[0][0]).toMatchObject({
      start_date: '2026-04-01',
      end_date: '2026-09-30',
    });
  });

  it('sends a null end date when only a start date is picked', async () => {
    picker.queue = [new Date(2026, 3, 1)];

    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);

    fireEvent.change(document.getElementById('contract-name')!, { target: { value: 'Open Ended' } });
    fireEvent.click(screen.getByTestId('client-picker'));
    fireEvent.click(screen.getAllByTestId('date-picker')[0]);

    fireEvent.submit(document.getElementById('contract-dialog-form')!);

    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
    expect(actionMocks.saveQuickAddContract.mock.calls[0][0]).toMatchObject({
      start_date: '2026-04-01',
      end_date: null,
    });
  });
});

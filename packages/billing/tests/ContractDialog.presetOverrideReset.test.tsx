// @vitest-environment jsdom
//
// The contract dialog stays mounted between contracts (Contracts.tsx,
// ClientContractsTab.tsx), so unmounting never clears it: every per-contract
// pricing override has to leave with the form it was typed into. This suite
// edits an hourly preset's service rate and minimum billable time, cancels,
// and reopens — the next contract must start from the preset's own defaults.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getClientByIdForBilling: vi.fn(),
  createClientContractForBilling: vi.fn(),
  getContractLinePresets: vi.fn(),
  getContractLinePresetServiceCounts: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
  copyPresetToContractLine: vi.fn(),
  createContract: vi.fn(),
  getServices: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: actionMocks.getClientByIdForBilling,
  createClientContractForBilling: actionMocks.createClientContractForBilling,
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServiceCounts: actionMocks.getContractLinePresetServiceCounts,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
  copyPresetToContractLine: actionMocks.copyPresetToContractLine,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  createContract: actionMocks.createContract,
  updateContract: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actionMocks.getServices,
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useContractLineTypeOptions: () => [{ value: 'Hourly', label: 'Hourly' }],
  useFormatContractLineType: () => (value?: string | null) => value ?? '',
  useFormatBillingFrequency: () => (value?: string | null) => value ?? '',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`));
    },
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
    isOpen ? (
      <div data-testid="contract-dialog">
        {children}
        {footer}
      </div>
    ) : null,
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

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ onChange }: { onChange: (date: Date | undefined) => void }) => (
    <button type="button" data-testid="date-picker" onClick={() => onChange(new Date('2026-03-01T00:00:00Z'))}>
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
  Checkbox: ({ id, checked, onChange }: { id?: string; checked?: boolean; onChange?: () => void }) => (
    <input type="checkbox" id={id} checked={!!checked} onChange={onChange} />
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const hourlyPreset = {
  preset_id: 'preset-hourly',
  preset_name: 'Hourly Support',
  contract_line_type: 'Hourly',
  billing_frequency: 'monthly',
  minimum_billable_time: 15,
  round_up_to_nearest: 15,
};

const hourlyPresetServices = [
  { preset_id: 'preset-hourly', service_id: 'svc-eng', custom_rate: 8500 },
];

const { ContractDialog } = await import('../src/components/billing-dashboard/contracts/ContractDialog');

const openDialog = async () => {
  fireEvent.click(screen.getByText('Quick Add Contract'));
  await screen.findByText('Hourly Support');
};

const expandPreset = async (expectedFetches: number) => {
  fireEvent.click(screen.getByText('Hourly Support'));
  await waitFor(() => {
    expect(actionMocks.getContractLinePresetServices).toHaveBeenCalledTimes(expectedFetches);
  });
  await screen.findByText('Senior Engineer');
};

const rateInput = () => document.getElementById('hourly-rate-preset-hourly-svc-eng') as HTMLInputElement;
const minimumInput = () => document.getElementById('min-billable-preset-hourly') as HTMLInputElement;

describe('ContractDialog preset override reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getClientByIdForBilling.mockResolvedValue(
      { client_id: 'client-1', client_name: 'Emerald City', default_currency_code: 'USD' },
    );
    actionMocks.getContractLinePresets.mockResolvedValue([hourlyPreset]);
    actionMocks.getContractLinePresetServiceCounts.mockResolvedValue({ 'preset-hourly': 1 });
    actionMocks.getContractLinePresetServices.mockResolvedValue(hourlyPresetServices);
    actionMocks.getContractLinePresetFixedConfig.mockResolvedValue(null);
    actionMocks.getServices.mockResolvedValue({
      services: [{ service_id: 'svc-eng', service_name: 'Senior Engineer', default_rate: 8500 }],
    });
    actionMocks.createContract.mockResolvedValue({ contract_id: 'contract-1' });
    actionMocks.createClientContractForBilling.mockResolvedValue({ client_contract_id: 'assignment-1' });
    actionMocks.copyPresetToContractLine.mockResolvedValue('line-1');
  });

  const renderDialog = () =>
    render(
      <ContractDialog
        onContractSaved={vi.fn()}
        triggerButton={<button type="button">Quick Add Contract</button>}
      />,
    );

  const editOverridesThenCancel = async () => {
    await openDialog();
    await expandPreset(1);

    const rate = rateInput();
    fireEvent.change(rate, { target: { value: '250.00' } });
    fireEvent.blur(rate);

    const minimum = minimumInput();
    fireEvent.change(minimum, { target: { value: '60' } });
    fireEvent.blur(minimum);

    // The edits landed on this contract's form...
    expect(rateInput().value).toBe('250.00');
    expect(minimumInput().value).toBe('60');

    // ...and are abandoned with it.
    fireEvent.click(document.getElementById('cancel-contract-btn')!);
  };

  it('applies no overrides from an earlier contract when the preset is reselected', async () => {
    renderDialog();
    await editOverridesThenCancel();

    await openDialog();

    fireEvent.click(document.getElementById('preset-preset-hourly')!);
    fireEvent.change(document.getElementById('contract-name')!, { target: { value: 'Second Contract' } });
    fireEvent.click(screen.getByTestId('client-picker'));
    fireEvent.click(screen.getAllByTestId('date-picker')[0]);

    fireEvent.submit(document.getElementById('contract-dialog-form')!);

    await waitFor(() => {
      expect(actionMocks.copyPresetToContractLine).toHaveBeenCalledTimes(1);
    });

    const [contractId, presetId, overrides] = actionMocks.copyPresetToContractLine.mock.calls[0];
    expect(contractId).toBe('contract-1');
    expect(presetId).toBe('preset-hourly');
    expect(overrides).toBeUndefined();
  });

  it('re-initializes the preset inputs from preset defaults on the next expand', async () => {
    renderDialog();
    await editOverridesThenCancel();

    await openDialog();
    await expandPreset(2);

    expect(rateInput().value).toBe('85.00');
    expect(minimumInput().value).toBe('15');
  });
});

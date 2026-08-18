// @vitest-environment jsdom

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getAllClientsForBilling: vi.fn(),
  getContractLinePresets: vi.fn(),
  getContractLinePresetServiceCounts: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: actionMocks.getAllClientsForBilling,
  createClientContractForBilling: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServiceCounts: actionMocks.getContractLinePresetServiceCounts,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
  copyPresetToContractLine: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  createContract: vi.fn(),
  updateContract: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useContractLineTypeOptions: () => [{ value: 'Fixed', label: 'Fixed' }],
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (value: number) => `$${value}`, symbol: '$' }),
}));

vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="contract-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
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

const presets = [
  { preset_id: 'preset-1', preset_name: 'Managed Services', contract_line_type: 'Fixed' },
  { preset_id: 'preset-2', preset_name: 'Backup', contract_line_type: 'Fixed' },
  { preset_id: 'preset-3', preset_name: 'Monitoring', contract_line_type: 'Fixed' },
];

const { ContractDialog } = await import('../src/components/billing-dashboard/contracts/ContractDialog');

describe('ContractDialog preset loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue([]);
    actionMocks.getContractLinePresets.mockResolvedValue(presets);
    actionMocks.getContractLinePresetServiceCounts.mockResolvedValue({
      'preset-1': 2,
      'preset-2': 1,
    });
  });

  it('issues no client or preset fetches while the dialog stays closed', async () => {
    render(<ContractDialog onContractSaved={vi.fn()} isOpen={false} onOpenChange={vi.fn()} />);

    await Promise.resolve();

    expect(actionMocks.getAllClientsForBilling).not.toHaveBeenCalled();
    expect(actionMocks.getContractLinePresets).not.toHaveBeenCalled();
    expect(actionMocks.getContractLinePresetServiceCounts).not.toHaveBeenCalled();
  });

  it('loads presets and their service counts in one batched call when opened', async () => {
    const { rerender } = render(
      <ContractDialog onContractSaved={vi.fn()} isOpen={false} onOpenChange={vi.fn()} />,
    );

    rerender(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(actionMocks.getContractLinePresetServiceCounts).toHaveBeenCalledTimes(1);
    });

    expect(actionMocks.getAllClientsForBilling).toHaveBeenCalledTimes(1);
    expect(actionMocks.getContractLinePresets).toHaveBeenCalledTimes(1);
    // The per-preset fan-out is gone: details stay lazy until a preset is expanded.
    expect(actionMocks.getContractLinePresetServices).not.toHaveBeenCalled();
  });
});

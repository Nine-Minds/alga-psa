// @vitest-environment jsdom
//
// Usage billing is record-driven: only period-dated usage_tracking records
// create charges, so preset authoring must never expose or persist a
// configured quantity for Usage services. This suite covers the
// AddContractLinesDialog usage preset section behaviorally: no quantity
// input renders, the record-driven prerequisite is explained, and applying
// the preset submits rate-only service overrides.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLinePresets: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
  copyPresetToContractLine: vi.fn(),
  getServices: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
  copyPresetToContractLine: actionMocks.copyPresetToContractLine,
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actionMocks.getServices,
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

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="add-contract-lines-dialog">
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange }: { id?: string; checked?: boolean; onChange?: () => void }) => (
    <input type="checkbox" id={id} checked={!!checked} onChange={onChange} />
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const usagePreset = {
  preset_id: 'preset-usage',
  preset_name: 'Seat Bundle',
  contract_line_type: 'Usage',
  billing_frequency: 'monthly',
};

// Legacy preset data may still carry a quantity; it must stay inert.
const usagePresetServices = [
  {
    preset_id: 'preset-usage',
    service_id: 'svc-seat',
    quantity: 9,
    custom_rate: 8500,
    unit_of_measure: 'seat',
  },
];

const { AddContractLinesDialog } = await import('../src/components/billing-dashboard/contracts/AddContractLinesDialog');

describe('AddContractLinesDialog usage preset authoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePresets.mockResolvedValue([usagePreset]);
    actionMocks.getContractLinePresetServices.mockResolvedValue(usagePresetServices);
    actionMocks.getContractLinePresetFixedConfig.mockResolvedValue(null);
    actionMocks.copyPresetToContractLine.mockResolvedValue('line-1');
    actionMocks.getServices.mockResolvedValue({
      services: [{ service_id: 'svc-seat', service_name: 'Basic Seat', default_rate: 8500 }],
    });
  });

  const renderAndExpandPreset = async () => {
    render(
      <AddContractLinesDialog
        isOpen
        onClose={vi.fn()}
        contractId="contract-1"
        onAdd={vi.fn(async () => {})}
      />
    );

    fireEvent.click(await screen.findByText('Seat Bundle'));
    await screen.findByText('Basic Seat');
  };

  it('shows no quantity input for usage services and explains record-driven billing', async () => {
    await renderAndExpandPreset();

    // The billing-ignored quantity is gone even though the preset data carries one...
    expect(document.getElementById('quantity-preset-usage-svc-seat')).toBeNull();
    expect(screen.queryByLabelText(/quantity/i)).toBeNull();

    // ...while the billing inputs that matter remain.
    expect(document.getElementById('rate-preset-usage-svc-seat')).not.toBeNull();
    expect(screen.getByText(/no usage record produces no charge/i)).toBeTruthy();
  });

  it('submits rate-only service overrides when applying a usage preset', async () => {
    await renderAndExpandPreset();

    fireEvent.click(document.getElementById('preset-preset-usage')!);

    const rateInput = document.getElementById('rate-preset-usage-svc-seat')!;
    fireEvent.change(rateInput, { target: { value: '99.00' } });
    fireEvent.blur(rateInput);

    fireEvent.click(document.getElementById('confirm-add-contract-lines')!);

    await waitFor(() => {
      expect(actionMocks.copyPresetToContractLine).toHaveBeenCalledTimes(1);
    });

    const [contractId, presetId, overrides] = actionMocks.copyPresetToContractLine.mock.calls[0];
    expect(contractId).toBe('contract-1');
    expect(presetId).toBe('preset-usage');
    expect(overrides.services['svc-seat']).toEqual({ custom_rate: 9900 });
    expect(overrides.services['svc-seat']).not.toHaveProperty('quantity');
  });
});

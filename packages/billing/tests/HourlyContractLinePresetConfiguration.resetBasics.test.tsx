// @vitest-environment jsdom
//
// Reset on the hourly preset basics form means "put the saved preset back",
// and the time settings (minimum billable time, rounding) are part of that
// form — so Reset has to restore them too, not just the name and frequency.
// The editor also must not reach for contract-line configurations keyed by a
// preset id: that model never holds preset services.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLinePresetById: vi.fn(),
  updateContractLinePreset: vi.fn(),
  getContractLineServicesWithConfigurations: vi.fn(() => {
    throw new Error('contract-line service configurations are the wrong model for a preset');
  }),
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresetById: actionMocks.getContractLinePresetById,
  updateContractLinePreset: actionMocks.updateContractLinePreset,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: actionMocks.getContractLineServicesWithConfigurations,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identity: the editor's fetch effect depends on `t`, so a fresh
  // function per render would refetch (and re-seed the form) on every render.
  const translation = {
    t: (key: string, options?: Record<string, unknown>) => {
      const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`));
    },
  };
  return { useTranslation: () => translation };
});

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id }: { id?: string }) => <div data-testid="custom-select" id={id} />,
}));

vi.mock(
  '../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList',
  () => ({
    default: ({ presetId }: { presetId: string }) => (
      <div data-testid="hourly-preset-services-list" data-preset-id={presetId} />
    ),
  }),
);

const hourlyPreset = {
  preset_id: 'preset-hourly',
  preset_name: 'Time & Materials',
  contract_line_type: 'Hourly',
  billing_frequency: 'monthly',
  minimum_billable_time: 15,
  round_up_to_nearest: 15,
  tenant: 'tenant-1',
};

const { HourlyPresetConfiguration } = await import(
  '../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetConfiguration'
);

const minimumInput = () => document.getElementById('minimum-billable-time') as HTMLInputElement;
const roundUpInput = () => document.getElementById('round-up-to-nearest') as HTMLInputElement;
const resetButton = () => document.getElementById('reset-hourly-plan-basics') as HTMLButtonElement;
const saveButton = () => document.getElementById('save-hourly-plan-basics') as HTMLButtonElement;

describe('HourlyPresetConfiguration basics reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePresetById.mockResolvedValue(hourlyPreset);
    actionMocks.updateContractLinePreset.mockResolvedValue(hourlyPreset);
  });

  const renderEditor = async () => {
    render(<HourlyPresetConfiguration presetId="preset-hourly" />);
    await screen.findByText('Edit Contract Line Preset: Time & Materials (Hourly)');
  };

  it('restores the saved time settings and clears the dirty flag', async () => {
    await renderEditor();

    expect(minimumInput().value).toBe('15');
    expect(roundUpInput().value).toBe('15');

    fireEvent.change(minimumInput(), { target: { value: '60' } });
    fireEvent.change(roundUpInput(), { target: { value: '30' } });

    expect(minimumInput().value).toBe('60');
    expect(resetButton().disabled).toBe(false);
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(resetButton());

    await waitFor(() => {
      expect(minimumInput().value).toBe('15');
    });
    expect(roundUpInput().value).toBe('15');
    expect(resetButton().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(actionMocks.updateContractLinePreset).not.toHaveBeenCalled();
  });

  it('renders the preset editor without reading contract-line service configurations', async () => {
    await renderEditor();

    expect(actionMocks.getContractLineServicesWithConfigurations).not.toHaveBeenCalled();
    expect(screen.getByTestId('hourly-preset-services-list')).toBeTruthy();
  });
});

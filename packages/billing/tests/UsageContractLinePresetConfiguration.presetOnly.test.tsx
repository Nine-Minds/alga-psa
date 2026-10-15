// @vitest-environment jsdom
//
// A usage preset's services live in contract_line_preset_services, so the
// preset editor is exactly two things: the preset basics form and the preset
// services list. It must not read (or write) contract-line service
// configurations keyed by a preset id — that model holds contract lines.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLinePresetById: vi.fn(),
  updateContractLinePreset: vi.fn(),
  getContractLineServicesWithConfigurations: vi.fn(() => {
    throw new Error('contract-line service configurations are the wrong model for a preset');
  }),
  getContractLineConfigurationForService: vi.fn(() => {
    throw new Error('contract-line service configurations are the wrong model for a preset');
  }),
  upsertPlanServiceConfiguration: vi.fn(() => {
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

vi.mock('@alga-psa/billing/actions/contractLineServiceConfigurationActions', () => ({
  getContractLineConfigurationForService: actionMocks.getContractLineConfigurationForService,
  upsertPlanServiceConfiguration: actionMocks.upsertPlanServiceConfiguration,
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
  '../src/components/billing-dashboard/contract-lines/UsageContractLinePresetServicesList',
  () => ({
    default: ({ presetId }: { presetId: string }) => (
      <div data-testid="usage-preset-services-list" data-preset-id={presetId} />
    ),
  }),
);

const usagePreset = {
  preset_id: 'preset-usage',
  preset_name: 'Metered Storage',
  contract_line_type: 'Usage',
  billing_frequency: 'monthly',
  tenant: 'tenant-1',
};

const { UsagePresetConfiguration } = await import(
  '../src/components/billing-dashboard/contract-lines/UsageContractLinePresetConfiguration'
);

describe('UsagePresetConfiguration preset-only surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePresetById.mockResolvedValue(usagePreset);
    actionMocks.updateContractLinePreset.mockResolvedValue(usagePreset);
  });

  const renderEditor = async () => {
    render(<UsagePresetConfiguration presetId="preset-usage" />);
    await screen.findByText('Edit Contract Line Preset: Metered Storage (Usage)');
  };

  it('renders one basics form plus the preset services list and nothing from the contract-line model', async () => {
    await renderEditor();

    expect(screen.getAllByText('Contract Line Preset Basics')).toHaveLength(1);
    expect(document.querySelectorAll('#name')).toHaveLength(1);
    expect(screen.getByTestId('usage-preset-services-list')).toBeTruthy();

    expect(actionMocks.getContractLineServicesWithConfigurations).not.toHaveBeenCalled();
    expect(actionMocks.getContractLineConfigurationForService).not.toHaveBeenCalled();
    expect(screen.queryByText('Service Pricing')).toBeNull();
    expect(document.getElementById('save-all-service-configs-button')).toBeNull();
  });

  it('saves the preset basics through the preset action', async () => {
    await renderEditor();

    fireEvent.change(document.getElementById('name')!, { target: { value: 'Metered Storage v2' } });
    fireEvent.click(document.getElementById('save-usage-plan-basics')!);

    await waitFor(() => {
      expect(actionMocks.updateContractLinePreset).toHaveBeenCalledTimes(1);
    });

    const [presetId, payload] = actionMocks.updateContractLinePreset.mock.calls[0];
    expect(presetId).toBe('preset-usage');
    expect(payload).toMatchObject({
      preset_name: 'Metered Storage v2',
      billing_frequency: 'monthly',
    });
    expect(actionMocks.upsertPlanServiceConfiguration).not.toHaveBeenCalled();
  });
});

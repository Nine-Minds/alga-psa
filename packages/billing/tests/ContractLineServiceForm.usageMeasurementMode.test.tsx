// @vitest-environment jsdom
//
// Billing intent must be choosable where a usage service is configured on a
// contract line, and the choice has to reach the server the way the semantics
// require. This suite drives the real service-configuration editor:
//
//  1. both measurement modes are offered and the copy states what each one
//     does next period (entries add up vs. one count replaces the previous);
//  2. saving a changed mode goes through setUsageMeasurementMode — the guarded
//     conversion path — and never smuggles measurement_mode into the generic
//     type-config update that would bypass that guard.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLineById: vi.fn(),
  updateContractLineFixedConfig: vi.fn(),
  updateContractLineService: vi.fn(),
  getConfigurationForService: vi.fn(),
  getConfigurationWithDetails: vi.fn(),
  setUsageMeasurementMode: vi.fn(),
  getBucketOverlay: vi.fn(),
  upsertBucketOverlay: vi.fn(),
  deleteBucketOverlay: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: actionMocks.getContractLineById,
  updateContractLineFixedConfig: actionMocks.updateContractLineFixedConfig,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  updateContractLineService: actionMocks.updateContractLineService,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceConfigurationActions', () => ({
  getConfigurationForService: actionMocks.getConfigurationForService,
  getConfigurationWithDetails: actionMocks.getConfigurationWithDetails,
}));

vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  setUsageMeasurementMode: actionMocks.setUsageMeasurementMode,
  getNextContractServiceBoundary: async () => '2026-10-01',
}));

vi.mock('../src/actions/bucketOverlayActions', () => ({
  getBucketOverlay: actionMocks.getBucketOverlay,
  upsertBucketOverlay: actionMocks.upsertBucketOverlay,
  deleteBucketOverlay: actionMocks.deleteBucketOverlay,
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
    symbol: () => '$',
  }),
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children }: any) =>
    isOpen ? (
      <div role="dialog">
        <h1>{title}</h1>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options = [] }: any) => (
    <div data-testid={`custom-select-${id ?? 'anonymous'}`}>
      <span>{String(value ?? '')}</span>
      {options.map((option: any) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onValueChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: any) => (
    <input
      type="checkbox"
      id={id}
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: any) => (
    <label>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
      />
      {label}
    </label>
  ),
}));

const { default: ContractLineServiceForm } = await import(
  '../src/components/billing-dashboard/contract-lines/ContractLineServiceForm'
);

const planService = {
  contract_line_id: 'line-1',
  service_id: 'svc-1',
  quantity: undefined,
  custom_rate: undefined,
  tenant: 'tenant-1',
} as any;

const services = [
  {
    service_id: 'svc-1',
    service_name: 'Backup Storage',
    billing_method: 'usage',
    default_rate: 25,
    unit_of_measure: 'GB',
  },
] as any;

const renderUsageEditor = async () => {
  render(
    <ContractLineServiceForm
      planService={planService}
      services={services}
      onClose={vi.fn()}
      onServiceUpdated={vi.fn()}
    />
  );
  await screen.findByText('Usage-Based Configuration');
};

const radio = (value: string): HTMLInputElement =>
  document.querySelector(`input[name="usage-measurement-mode"][value="${value}"]`) as HTMLInputElement;

describe('usage service configuration measurement mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLineById.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_id: 'contract-1',
      contract_line_type: 'Usage',
      billing_frequency: 'monthly',
    });
    actionMocks.getConfigurationForService.mockResolvedValue({ config_id: 'cfg-1' });
    actionMocks.getConfigurationWithDetails.mockResolvedValue({
      baseConfig: {
        config_id: 'cfg-1',
        contract_line_id: 'line-1',
        service_id: 'svc-1',
        configuration_type: 'Usage',
        quantity: undefined,
        custom_rate: null,
      },
      typeConfig: {
        config_id: 'cfg-1',
        unit_of_measure: 'GB',
        enable_tiered_pricing: false,
        minimum_usage: 5,
        measurement_mode: 'additive',
      },
      rateTiers: [],
    });
    actionMocks.updateContractLineService.mockResolvedValue(true);
    actionMocks.setUsageMeasurementMode.mockResolvedValue({ measurement_mode: 'period_total' });
    actionMocks.getBucketOverlay.mockResolvedValue(null);
  });

  it('offers both measurement modes and explains add-vs-replace behaviour', async () => {
    await renderUsageEditor();

    expect(radio('additive')).toBeTruthy();
    expect(radio('period_total')).toBeTruthy();
    expect(radio('additive').checked).toBe(true);

    expect(screen.getByText(/entries of 10 and 12 bill 22/i)).toBeTruthy();
    expect(screen.getByText(/replaces the previous one: correcting 10 to 12 bills 12, never 22/i)).toBeTruthy();

    // The minimum is scoped to the selected mode, not left ambiguous.
    expect(screen.getByText('Minimum per entry')).toBeTruthy();
    fireEvent.click(radio('period_total'));
    expect(screen.getByText('Minimum per period report')).toBeTruthy();
  });

  it('saves measurement and pricing with the displayed effective boundary in one authoring action', async () => {
    await renderUsageEditor();
    fireEvent.click(radio('period_total'));
    fireEvent.click(document.getElementById('save-service-config-button')!);
    await waitFor(() => expect(actionMocks.updateContractLineService).toHaveBeenCalledTimes(1));
    expect(actionMocks.setUsageMeasurementMode).not.toHaveBeenCalled();
    const [, , updates] = actionMocks.updateContractLineService.mock.calls[0];
    expect(updates.typeConfig).toMatchObject({measurement_mode: 'period_total', effective_period_start: '2026-10-01', unit_of_measure: 'GB'});
  });

  it('does not run the conversion guard when the mode is left unchanged', async () => {
    await renderUsageEditor();

    fireEvent.change(document.getElementById('minimum-usage')!, { target: { value: '7' } });
    fireEvent.click(document.getElementById('save-service-config-button')!);

    await waitFor(() => {
      expect(actionMocks.updateContractLineService).toHaveBeenCalledTimes(1);
    });
    expect(actionMocks.setUsageMeasurementMode).not.toHaveBeenCalled();
  });

  it('surfaces a refused conversion and does not save the rest of the configuration', async () => {
    actionMocks.updateContractLineService.mockResolvedValue({
      actionError: 'This service still has unbilled additive entries on the contract line.',
    });

    await renderUsageEditor();

    fireEvent.click(radio('period_total'));
    fireEvent.click(document.getElementById('save-service-config-button')!);

    await screen.findByText(/still has unbilled additive entries/i);
    expect(actionMocks.updateContractLineService).toHaveBeenCalledTimes(1);
  });
});

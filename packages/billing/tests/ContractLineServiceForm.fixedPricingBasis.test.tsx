// @vitest-environment jsdom
//
// A fixed member's quantity means one of two different things, and the editor
// has to make the operator choose which. This suite drives the real
// service-configuration editor for a Fixed service:
//
//  1. bundle pricing (the legacy default) presents the quantity as an
//     allocation of the line total and never as billable seats;
//  2. choosing recurring seats/units shows the quantity × unit rate
//     calculation and saves pricing_basis='unit' together with the quantity
//     and unit rate the operator entered.

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
  // loadConfiguration resolves the next service boundary before fetching
  // configuration details, so the editor never renders when this is absent.
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
        <button key={option.value} type="button" onClick={() => onValueChange?.(option.value)}>
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
  service_id: 'svc-standard',
  quantity: 9,
  custom_rate: undefined,
  tenant: 'tenant-1',
} as any;

const services = [
  {
    service_id: 'svc-standard',
    service_name: 'Standard Workstation',
    billing_method: 'fixed',
    default_rate: 100,
  },
] as any;

const renderFixedEditor = async () => {
  render(
    <ContractLineServiceForm
      planService={planService}
      services={services}
      onClose={vi.fn()}
      onServiceUpdated={vi.fn()}
    />
  );
  await screen.findByText('Fixed Price Configuration');
};

const basisRadio = (value: string): HTMLInputElement =>
  document.querySelector(`input[name="fixed-pricing-basis"][value="${value}"]`) as HTMLInputElement;

describe('fixed service configuration pricing basis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLineById.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_id: 'contract-1',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
    });
    actionMocks.getConfigurationForService.mockResolvedValue({ config_id: 'cfg-fixed' });
    actionMocks.getConfigurationWithDetails.mockResolvedValue({
      baseConfig: {
        config_id: 'cfg-fixed',
        contract_line_id: 'line-1',
        service_id: 'svc-standard',
        configuration_type: 'Fixed',
        quantity: 9,
        custom_rate: null,
      },
      // Legacy fixed member: no explicit basis, so it stays a bundle allocation.
      typeConfig: { config_id: 'cfg-fixed', base_rate: null, pricing_basis: null },
      planFixedConfig: { enable_proration: false, billing_cycle_alignment: 'start' },
      rateTiers: [],
    });
    actionMocks.updateContractLineService.mockResolvedValue(true);
    actionMocks.updateContractLineFixedConfig.mockResolvedValue(true);
  });

  it('presents a legacy bundle quantity as an allocation, not as billable seats', async () => {
    await renderFixedEditor();

    expect(basisRadio('bundle').checked).toBe(true);
    expect(screen.getByTestId('fixed-bundle-allocation-note').textContent).toContain(
      'not billed as seats'
    );
    expect(screen.queryByTestId('fixed-unit-pricing-summary')).toBeNull();
    expect(screen.queryByText(/recurring seats\)/i)).toBeNull();
  });

  it('saves recurring seats as pricing_basis unit with the quantity and unit rate', async () => {
    await renderFixedEditor();

    fireEvent.click(basisRadio('unit'));
    fireEvent.change(document.getElementById('service-quantity')!, { target: { value: '10' } });
    fireEvent.change(document.getElementById('fixed-service-unit-rate')!, {
      target: { value: '100.00' },
    });

    expect(screen.getByTestId('fixed-unit-pricing-summary').textContent).toContain(
      '10 × $100.00 (recurring seats) = $1000.00 per period'
    );

    fireEvent.click(document.getElementById('save-service-config-button')!);

    await waitFor(() => {
      expect(actionMocks.updateContractLineService).toHaveBeenCalledTimes(1);
    });

    const [contractLineId, serviceId, updates] = actionMocks.updateContractLineService.mock.calls[0];
    expect(contractLineId).toBe('line-1');
    expect(serviceId).toBe('svc-standard');
    expect(updates.quantity).toBe(10);
    expect(updates.typeConfig).toMatchObject({ pricing_basis: 'unit', base_rate: 10000 });
  });
});

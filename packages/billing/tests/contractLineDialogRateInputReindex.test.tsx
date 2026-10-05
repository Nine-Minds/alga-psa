// @vitest-environment jsdom

/**
 * Removing a service row must not repaint another row's rate. The rate text is
 * held in index-keyed maps beside the service array, so a removal has to shift
 * those strings down with the rows that moved.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
  getServiceById: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  createContractLinePreset: vi.fn(),
  updateContractLinePreset: vi.fn(),
  updateContractLinePresetFixedConfig: vi.fn(),
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
  updateContractLinePresetServices: vi.fn(),
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServiceById: actionMocks.getServiceById,
}));

vi.mock('@alga-psa/billing/actions/unitOfMeasureActions', () => ({
  listTenantUnitsOfMeasure: vi.fn(async () => []),
  registerTenantUnitOfMeasure: vi.fn(),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

const translate = (_key: string, second?: string | Record<string, unknown>) => {
  const options = typeof second === 'object' && second ? second : {};
  let value = String((typeof second === 'string' ? second : options.defaultValue) ?? _key);
  for (const [name, replacement] of Object.entries(options)) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useOptionalI18n: () => ({ locale: 'en-US' }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div role="dialog">{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({ SwitchWithLabel: () => null }));
vi.mock('@alga-psa/ui/components/UnitOfMeasureInput', () => ({ UnitOfMeasureInput: () => null }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));
vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ selectedLabel }: { selectedLabel?: string }) => <div>{selectedLabel}</div>,
}));
vi.mock('../src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel', () => ({
  FixedServiceConfigPanel: () => null,
}));

import { ContractLineDialog, reindexRateInputs } from '../src/components/billing-dashboard/ContractLineDialog';

const presetService = (serviceId: string, customRate: number) => ({
  service_id: serviceId,
  custom_rate: customRate,
  quantity: 1,
  unit_of_measure: 'unit',
});

const renderDialog = (contractLineType: 'Hourly' | 'Usage') => render(
  <ContractLineDialog
    onPlanAdded={vi.fn()}
    allServiceTypes={[]}
    editingPlan={{
      preset_id: 'preset-1',
      preset_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: contractLineType,
      billing_timing: 'arrears',
    } as any}
  />
);

const rateInput = (prefix: string, index: number) =>
  document.getElementById(`${prefix}-${index}`) as HTMLInputElement | null;

describe('reindexRateInputs', () => {
  it('shifts entries above the removed index down one and drops the removed one', () => {
    const inputs = { 0: '100.00', 1: '200.00', 2: '300.00' };

    expect(reindexRateInputs(inputs, 0)).toEqual({ 0: '200.00', 1: '300.00' });
    expect(reindexRateInputs(inputs, 1)).toEqual({ 0: '100.00', 1: '300.00' });
    expect(reindexRateInputs(inputs, 2)).toEqual({ 0: '100.00', 1: '200.00' });
  });

  it('leaves sparse maps aligned when a row without a typed rate is removed', () => {
    expect(reindexRateInputs({ 0: '100.00', 2: '300.00' }, 1)).toEqual({ 0: '100.00', 1: '300.00' });
  });

  it('returns an empty map when the only row is removed', () => {
    expect(reindexRateInputs({ 0: '100.00' }, 0)).toEqual({});
  });
});

describe('ContractLineDialog service removal keeps rates with their rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePresetFixedConfig.mockResolvedValue(null);
    actionMocks.getContractLinePresetServices.mockResolvedValue([
      presetService('svc-a', 10000),
      presetService('svc-b', 20000),
      presetService('svc-c', 30000),
    ]);
    actionMocks.getServiceById.mockImplementation(async (serviceId: string) => ({
      service_name: `Service ${serviceId}`,
      item_kind: 'service',
    }));
  });

  it('keeps each remaining hourly rate on its own row after a removal and blur', async () => {
    renderDialog('Hourly');

    await waitFor(() => expect(rateInput('hourly-rate', 2)?.value).toBe('300.00'));
    expect(rateInput('hourly-rate', 0)!.value).toBe('100.00');
    expect(rateInput('hourly-rate', 1)!.value).toBe('200.00');

    fireEvent.click(document.getElementById('remove-hourly-service-0')!);

    await waitFor(() => expect(rateInput('hourly-rate', 2)).toBeNull());
    expect(rateInput('hourly-rate', 0)!.value).toBe('200.00');
    expect(rateInput('hourly-rate', 1)!.value).toBe('300.00');

    // Blurring the shifted last row must commit $300, not its predecessor's $200.
    fireEvent.blur(rateInput('hourly-rate', 1)!);

    await waitFor(() => expect(screen.getByText('$300.00/hour')).not.toBeNull());
    expect(rateInput('hourly-rate', 1)!.value).toBe('300.00');
    expect(screen.getByText('$200.00/hour')).not.toBeNull();
  });

  it('keeps each remaining usage rate on its own row after a removal and blur', async () => {
    renderDialog('Usage');

    await waitFor(() => expect(rateInput('unit-rate', 2)?.value).toBe('300.00'));
    expect(rateInput('unit-rate', 0)!.value).toBe('100.00');
    expect(rateInput('unit-rate', 1)!.value).toBe('200.00');

    fireEvent.click(document.getElementById('remove-usage-service-0')!);

    await waitFor(() => expect(rateInput('unit-rate', 2)).toBeNull());
    expect(rateInput('unit-rate', 0)!.value).toBe('200.00');
    expect(rateInput('unit-rate', 1)!.value).toBe('300.00');

    fireEvent.blur(rateInput('unit-rate', 1)!);

    await waitFor(() => expect(screen.getByText('$300.00/unit')).not.toBeNull());
    expect(rateInput('unit-rate', 1)!.value).toBe('300.00');
    expect(screen.getByText('$200.00/unit')).not.toBeNull();
  });
});

describe('ContractLineDialog number inputs ignore the mouse wheel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePresetFixedConfig.mockResolvedValue(null);
    actionMocks.getContractLinePresetServices.mockResolvedValue([presetService('svc-a', 10000)]);
    actionMocks.getServiceById.mockResolvedValue({ service_name: 'Service A', item_kind: 'service' });
  });

  it('blurs the hourly rounding fields instead of stepping their value', async () => {
    renderDialog('Hourly');

    const minimumBillable = await waitFor(() => {
      const node = document.getElementById('minimum-billable-time') as HTMLInputElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.change(minimumBillable, { target: { value: '15' } });
    minimumBillable.focus();
    expect(document.activeElement).toBe(minimumBillable);

    fireEvent.wheel(minimumBillable, { deltaY: -100 });

    expect(document.activeElement).not.toBe(minimumBillable);
    expect(minimumBillable.value).toBe('15');

    const roundUp = document.getElementById('round-up-to-nearest') as HTMLInputElement;
    fireEvent.change(roundUp, { target: { value: '30' } });
    roundUp.focus();
    fireEvent.wheel(roundUp, { deltaY: 100 });
    expect(document.activeElement).not.toBe(roundUp);
    expect(roundUp.value).toBe('30');
  });
});

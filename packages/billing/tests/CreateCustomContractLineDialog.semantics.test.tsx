// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({ createCustomContractLine: vi.fn() }));

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
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div role="dialog">
        <h1>{title}</h1>
        {children}
        {footer}
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


vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({ createCustomContractLine: actionMocks.createCustomContractLine }));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({ useBillingFrequencyOptions: () => [{value: 'monthly', label: 'Monthly'}] }));
vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ onSelect }: any) => <button type="button" onClick={() => onSelect({service_id: 'svc-1', service_name: 'Seats', default_rate: 10000, unit_of_measure: 'seat'})}>Select Seats</button>,
}));
vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({BucketOverlayFields: () => null}));
const { CreateCustomContractLineDialog } = await import('../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog');

const change = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, {target: {value}});
const choose = (name: string, value: string) => fireEvent.click(document.querySelector(`input[name="${name}"][value="${value}"]`)!);
const open = (model: 'Fixed' | 'Usage') => {
  render(<CreateCustomContractLineDialog isOpen contractId="contract-1" onClose={vi.fn()} onCreated={vi.fn().mockResolvedValue(undefined)} />);
  change('name', 'Seats agreement');
  fireEvent.click(screen.getByText(model === 'Fixed' ? 'Fixed Fee' : 'Usage-Based'));
  fireEvent.click(document.getElementById(model === 'Fixed' ? 'add-fixed-service-button' : 'add-usage-service-button')!);
  fireEvent.click(screen.getByText('Select Seats'));
};
const save = () => fireEvent.submit(document.getElementById('custom-contract-line-form')!);

describe('custom contract line semantic authoring in the active dialog', () => {
  beforeEach(() => { vi.clearAllMocks(); actionMocks.createCustomContractLine.mockResolvedValue('line-new'); });

  it('saves period-total measurement, minimum and tier prices from the visible controls', async () => {
    open('Usage');
    expect(screen.getByText('Minimum per entry')).toBeTruthy();
    choose('custom-usage-0-usage-measurement-mode', 'period_total');
    expect(screen.getByText('Minimum per period report')).toBeTruthy();
    change('custom-usage-0-minimum-usage', '5');
    fireEvent.click(document.getElementById('custom-usage-0-enable-tiered-pricing')!);
    fireEvent.click(document.getElementById('custom-usage-0-add-tier-button')!);
    const rate = document.querySelector('input[id^="custom-usage-0-tier-"][id$="-rate"]')!;
    fireEvent.change(rate, {target: {value: '85.25'}});
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      contract_line_type: 'Usage', services: [expect.objectContaining({
        measurement_mode: 'period_total', minimum_usage: 5, enable_tiered_pricing: true,
        custom_rate: 10000, unit_of_measure: 'seat', rate_tiers: [{min_quantity: 0, max_quantity: 100, rate: 8525}],
      })],
    }));
    expect(actionMocks.createCustomContractLine.mock.calls[0][1].services[0]).not.toHaveProperty('quantity');
  });

  it('saves explicit additive semantics and keeps service radio groups independent', async () => {
    open('Usage');
    fireEvent.click(document.getElementById('add-usage-service-button')!);
    choose('custom-usage-0-usage-measurement-mode', 'period_total');
    expect((document.querySelector('input[name="custom-usage-1-usage-measurement-mode"][value="additive"]') as HTMLInputElement).checked).toBe(true);
    choose('custom-usage-0-usage-measurement-mode', 'additive');
    fireEvent.click(document.getElementById('remove-usage-service-1')!);
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine.mock.calls[0][1].services[0].measurement_mode).toBe('additive');
  });

  it.each([10, 0])('persists recurring quantity %s and a minor-unit rate without a bundle override', async quantity => {
    open('Fixed');
    choose('custom-fixed-0-fixed-pricing-basis', 'unit');
    change('quantity-0', String(quantity));
    change('custom-fixed-0-fixed-service-unit-rate', '1');
    expect((document.getElementById('custom-fixed-0-fixed-service-unit-rate') as HTMLInputElement).value).toBe('1');
    change('custom-fixed-0-fixed-service-unit-rate', '100.25');
    expect(screen.getByTestId('fixed-unit-pricing-summary').textContent).toContain(`${quantity} × $100.25`);
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      contract_line_type: 'Fixed', base_rate: null,
      services: [{service_id: 'svc-1', quantity, pricing_basis: 'unit', custom_rate: 10025}],
    }));
  });

  it('keeps bundle allocations explicit and requires a recurring unit rate before saving', async () => {
    open('Fixed');
    expect(screen.getByTestId('fixed-bundle-allocation-note').textContent).toContain('not billed as seats');
    choose('custom-fixed-0-fixed-pricing-basis', 'unit');
    save();
    expect(await screen.findByText('Enter a unit rate for each recurring service.')).toBeTruthy();
    expect(actionMocks.createCustomContractLine).not.toHaveBeenCalled();
    choose('custom-fixed-0-fixed-pricing-basis', 'bundle');
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine.mock.calls[0][1].services[0].pricing_basis).toBe('bundle');
  });
});

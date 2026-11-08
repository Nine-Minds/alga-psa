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

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useFormatters: () => ({ locale: 'en' }),
  useOptionalI18n: () => null,
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
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ id, value, onChange, currencyCode }: any) => (
    <input
      id={id}
      data-currency={currencyCode}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  ),
}));
const { CreateCustomContractLineDialog } = await import('../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog');

const change = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
const save = () => fireEvent.submit(document.getElementById('custom-contract-line-form')!);
const openPrepaid = (currencyCode: string | null = 'EUR') => {
  render(
    <CreateCustomContractLineDialog
      isOpen
      contractId="contract-1"
      currencyCode={currencyCode ?? undefined}
      onClose={vi.fn()}
      onCreated={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  change('name', 'Support block');
  fireEvent.click(document.getElementById('custom-line-model-PrepaidBlock')!);
  fireEvent.click(document.getElementById('add-hourly-service-button')!);
  fireEvent.click(screen.getByText('Select Seats'));
};

describe('Create Custom dialog: Prepaid Block option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.createCustomContractLine.mockResolvedValue('line-new');
  });

  it('offers Prepaid Block as a model, hides the per-service bucket switch, and shows the block fields', () => {
    openPrepaid();
    expect(document.getElementById('custom-line-prepaid-block-fields')).toBeTruthy();
    expect(document.getElementById('custom-line-prepaid-block-hours')).toBeTruthy();
    expect(document.getElementById('custom-line-prepaid-block-trigger-renewal')).toBeTruthy();
    expect(screen.queryByText('Add bucket of hours')).toBeNull();
    expect((document.getElementById('custom-line-prepaid-block-price') as HTMLInputElement).dataset.currency).toBe('EUR');
  });

  it('saves an Hourly line with a prepaid_block whose price defaults to hours x rate, stored explicitly', async () => {
    openPrepaid();
    change('custom-line-prepaid-block-hours', '40');
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      contract_line_type: 'Hourly',
      services: [expect.objectContaining({ service_id: 'svc-1', custom_rate: 10000, bucket_overlay: null })],
      prepaid_block: expect.objectContaining({
        block_minutes: 2400, block_price: 400000, expiry_months: 12, trigger_on_expiry: true,
        trigger_on_exhaustion: true, replenishment_tier: 'draft',
      }),
    }));
  });

  it('lets the user type an explicit price and a fractional block size', async () => {
    openPrepaid();
    change('custom-line-prepaid-block-hours', '1.5');
    change('custom-line-prepaid-block-price', '123.45');
    fireEvent.click(document.getElementById('custom-line-prepaid-block-trigger-renewal')!);
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine.mock.calls[0][1].prepaid_block).toMatchObject({
      block_minutes: 90, block_price: 12345, trigger_on_renewal: true,
    });
  });

  it('blocks the save with a message when the block size is missing', async () => {
    openPrepaid();
    save();
    expect(await screen.findByText('Enter a block size greater than zero (fractions of an hour are allowed).')).toBeTruthy();
    expect(actionMocks.createCustomContractLine).not.toHaveBeenCalled();
  });

  it('refuses to price a block without a contract currency', async () => {
    openPrepaid(null);
    expect(document.getElementById('custom-line-prepaid-block-currency-missing')).toBeTruthy();
    save();
    expect((await screen.findAllByText('The contract needs a currency before a prepaid block can be priced.')).length).toBeGreaterThan(0);
    expect(actionMocks.createCustomContractLine).not.toHaveBeenCalled();
  });

  it('does not send prepaid_block for a plain Hourly line', async () => {
    render(<CreateCustomContractLineDialog isOpen contractId="contract-1" currencyCode="EUR" onClose={vi.fn()} onCreated={vi.fn().mockResolvedValue(undefined)} />);
    change('name', 'Plain hourly');
    fireEvent.click(document.getElementById('custom-line-model-Hourly')!);
    fireEvent.click(document.getElementById('add-hourly-service-button')!);
    fireEvent.click(screen.getByText('Select Seats'));
    save();
    await waitFor(() => expect(actionMocks.createCustomContractLine).toHaveBeenCalledTimes(1));
    expect(actionMocks.createCustomContractLine.mock.calls[0][1]).not.toHaveProperty('prepaid_block');
  });
});

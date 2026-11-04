// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultContractWizardData } from '../ContractWizard';

/**
 * Wizard-state semantics of the timing controls: a line with no timing of its own follows the
 * contract default (its control reads "Use contract default"); a line with an explicit choice does
 * not move when the default changes. Covers fixed lines and the products line.
 */

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_m, token) => String(options?.[token] ?? ''));
    },
  }),
  useFormatters: () => ({ formatDate: (value: Date) => value.toISOString().slice(0, 10) }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: (props: { id: string; value: string; options: Array<{ value: string; label: string }>; onValueChange: (v: string) => void }) => (
    <div data-testid={props.id} data-value={props.value}>
      {props.options.map((o) => (
        <button key={o.value} type="button" data-opt={`${props.id}:${o.value}`} onClick={() => props.onValueChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/billing/actions/billingCycleAnchorActions', () => ({
  getClientBillingCycleAnchor: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServiceCatalogRatesForCurrency: vi.fn(async () => ({})),
  getServiceById: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/core', () => ({ getCurrencySymbol: () => '$', currencyFractionDigits: () => 2 }));
vi.mock('../ServiceCatalogPicker', () => ({ ServiceCatalogPicker: () => <div /> }));
vi.mock('../BillingFrequencyOverrideSelect', () => ({ BillingFrequencyOverrideSelect: () => <div /> }));

const { FixedFeeServicesStep } = await import('./FixedFeeServicesStep');
const { ProductsStep } = await import('./ProductsStep');

const member = { service_id: 'svc-1', service_name: 'Managed', quantity: 1, pricing_basis: 'bundle' as const };

function Harness() {
  const [data, setData] = useState<any>({
    ...createDefaultContractWizardData(),
    client_id: 'client-1',
    cadence_owner: 'contract',
    billing_timing: 'arrears',
    fixed_lines: [
      { line_key: 'inherit', enable_proration: false, base_rate: null, services: [member] },
      { line_key: 'override', enable_proration: false, base_rate: null, services: [member], billing_timing: 'arrears' },
    ],
    product_services: [{ service_id: 'prod-1', service_name: 'Licence', quantity: 1 }],
  });
  const updateData = (patch: any) => setData((prev: any) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  return (
    <>
      <button type="button" id="set-default-advance" onClick={() => updateData({ billing_timing: 'advance' })} />
      <button type="button" id="set-default-arrears" onClick={() => updateData({ billing_timing: 'arrears' })} />
      <FixedFeeServicesStep data={data} updateData={updateData} />
      <ProductsStep data={data} updateData={updateData} />
      <output data-testid="state">{JSON.stringify({
        d: data.billing_timing,
        l: data.fixed_lines.map((l: any) => l.billing_timing ?? null),
        p: data.product_billing_timing ?? null,
      })}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!);
const select = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(document.getElementById(id)!);

describe('billing timing: inherit vs override', () => {
  afterEach(() => cleanup());

  it('unset lines follow the contract default; explicit lines do not move', () => {
    render(<Harness />);
    // fixed-line ids are `<prefix>-billing-timing`; locate by suffix.
    const lineSelects = () => Array.from(document.querySelectorAll('[data-testid$="-billing-timing"]')) as HTMLElement[];
    expect(lineSelects().map((el) => el.dataset.value)).toEqual(['inherit', 'arrears', 'inherit']);
    expect(screen.getAllByText('Use contract default — in arrears')).toHaveLength(3);

    click('set-default-advance');
    expect(state()).toEqual({ d: 'advance', l: [null, 'arrears'], p: null });
    // Inherited controls now read advance; the explicit one is untouched.
    expect(screen.getAllByText('Use contract default — in advance')).toHaveLength(3);
    expect(lineSelects().map((el) => el.dataset.value)).toEqual(['inherit', 'arrears', 'inherit']);
  });

  it('choosing a value stores an explicit override that survives a default change; inherit clears it', () => {
    render(<Harness />);
    const optionButtons = (suffix: string) =>
      Array.from(document.querySelectorAll(`[data-opt$="${suffix}"]`)) as HTMLElement[];

    // Products line: explicit advance, then the default moves.
    fireEvent.click(document.querySelector('[data-opt="products-billing-timing:advance"]')!);
    expect(state().p).toBe('advance');
    click('set-default-advance');
    click('set-default-arrears');
    expect(state().p).toBe('advance');
    expect(select('products-billing-timing').dataset.value).toBe('advance');

    // Back to inherit.
    fireEvent.click(document.querySelector('[data-opt="products-billing-timing:inherit"]')!);
    expect(state().p).toBeNull();
    expect(select('products-billing-timing').dataset.value).toBe('inherit');

    // First fixed line: explicit advance, then inherit again.
    fireEvent.click(optionButtons(':advance')[0]);
    expect(state().l[0]).toBe('advance');
    fireEvent.click(optionButtons(':inherit')[0]);
    expect(state().l[0]).toBeNull();
  });
});

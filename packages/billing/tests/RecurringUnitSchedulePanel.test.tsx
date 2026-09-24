// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const actions = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn() }));
vi.mock('@alga-psa/billing/actions/contractLineUnitPricingActions', () => ({
  getEffectiveRecurringUnitPricing: actions.read,
  scheduleRecurringUnitPricingRevision: actions.save,
  listRecurringUnitPricingRevisions: async () => [],
  listRecurringUnitPricingRevisionHistory: async () => [],
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({ getNextContractServiceBoundary: async () => '2027-01-01' }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ previewRecurringRevisionInvoiceImpact: actions.preview }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: Record<string, any> = {}) =>
    String(options.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_, key) => String(options[key])) }),
  useFormatters: () => ({ formatCurrency: (amount: number) => `$${amount.toFixed(2)}` }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ value, onValueChange, options, id }: any) =>
  <select id={id} value={value} onChange={event => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, size, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
import { RecurringUnitSchedulePanel } from '../src/components/billing-dashboard/contracts/RecurringUnitSchedulePanel';

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  actions.read.mockResolvedValue({ quantity: 20, pricePolicy: 'override', unitRateCents: 12000,
    resolvedUnitRateCents: 12000, catalogUnitRateCents: 10000, baselineQuantity: 20,
    baselineUnitRateCents: 10000, currencyCode: 'USD', coveredStart: '2027-01-01', coveredEnd: '2027-02-01' });
  actions.save.mockResolvedValue({ revision_id: 'revision', version: 1 });
});
async function mount() {
  render(<RecurringUnitSchedulePanel contractLineId="line" serviceId="service" configId="config" currencyCode="USD" />);
  await waitFor(() => expect((document.querySelector('#recurring-quantity-config') as HTMLInputElement)?.value).toBe('20'));
}

describe('Recurring unit schedule panel', () => {
  it('switches an override to the catalog price for the selected boundary', async () => {
    await mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'catalog' } });
    expect(screen.getByText(/subtotal for this item changes/).textContent).toContain('$2000.00');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule change' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ price_policy: 'catalog', unit_rate_cents: null, expected_version: null })));
  });
  it('blocks a missing catalog price for positive quantities but permits a zero stop', async () => {
    actions.read.mockResolvedValue({ quantity: 20, pricePolicy: 'catalog', unitRateCents: null,
      catalogUnitRateCents: null, currencyCode: 'EUR', baselineQuantity: 20 });
    await mount();
    const save = screen.getByRole('button', { name: 'Schedule change' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/No EUR catalog price/)).toBeTruthy();
    fireEvent.change(document.querySelector('#recurring-quantity-config')!, { target: { value: '0' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 })));
  });
  it('shows pipeline totals and discounts, then clears the estimate when inputs change', async () => {
    actions.preview.mockResolvedValue({ success: true, windowStart: '2027-01-01', windowEnd: '2027-02-01',
      before: { total: 419000, currencyCode: 'USD' },
      after: { subtotal: 410000, tax: 42000, total: 452000, currencyCode: 'USD', items: [{ id: 'discount', description: 'Contract discount', total: -10000 }] } });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));
    await screen.findByText(/Subtotal after discounts: \$4100.00/);
    expect(screen.getByText(/Contract discount: -?\$-?100.00/)).toBeTruthy();
    fireEvent.change(document.querySelector('#recurring-quantity-config')!, { target: { value: '23' } });
    expect(screen.queryByText(/Subtotal after discounts/)).toBeNull();
  });
  it('shows preview errors without inventing a total', async () => {
    actions.preview.mockResolvedValue({ success: false, error: 'Prepare service periods in Billing.' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));
    await screen.findByText('Prepare service periods in Billing.');
    expect(screen.queryByText(/Subtotal after discounts/)).toBeNull();
  });
});

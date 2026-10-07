// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const actions = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn(), revisions: vi.fn(), history: vi.fn(), resolve: vi.fn() }));
vi.mock('@alga-psa/billing/actions/contractLineUnitPricingActions', () => ({
  getEffectiveRecurringUnitPricing: actions.read,
  scheduleRecurringUnitPricingRevision: actions.save,
  listRecurringUnitPricingRevisions: actions.revisions,
  listRecurringUnitPricingRevisionHistory: actions.history,
  resolveRecurringUnitMidPeriod: actions.resolve,
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({ getNextContractServiceBoundary: async () => '2027-01-01' }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ previewRecurringRevisionInvoiceImpact: actions.preview }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: Record<string, any> = {}) =>
    String(options.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_, key) => String(options[key])) }),
  useFormatters: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    // Distinguishable from the ISO wire value so a raw date can never pass for a formatted one.
    formatDate: (value: string) => `D(${value})`,
  }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ value, onValueChange, options, id }: any) =>
  <select id={id} value={value} onChange={event => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, size, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value, onChange }: { id?: string; value?: Date; onChange: (date: Date | undefined) => void }) => (
    <input
      id={id}
      type="date"
      value={value
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''}
      onChange={(event) => onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)}
    />
  ),
}));
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
  actions.revisions.mockResolvedValue([]);
  actions.history.mockResolvedValue([]);
  actions.resolve.mockResolvedValue({ periodStart: '2027-01-01', periodEnd: '2027-02-01',
    previousQuantity: 20, unitRateCents: 12000, pricePolicy: 'override', currencyCode: 'USD' });
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
  it('names audit actors instead of showing raw user ids', async () => {
    const replacer = '11111111-1111-4111-8111-111111111111';
    const departed = '22222222-2222-4222-8222-222222222222';
    actions.revisions.mockResolvedValue([{ revision_id: 'r1', quantity: 30, unit_rate_cents: 12000, price_policy: 'override',
      version: 2, effective_period_start: '2027-02-01', created_by: departed, updated_by: replacer,
      created_by_name: null, updated_by_name: 'Glinda Good', created_at: null, updated_at: null }]);
    actions.history.mockResolvedValue([
      { history_id: 'h1', revision_id: 'r1', quantity: 25, unit_rate_cents: 11000, price_policy: 'override',
        effective_period_start: '2027-02-01', version: 1, superseded_by: 'system', superseded_by_name: null },
      { history_id: 'h2', revision_id: 'r1', quantity: 20, unit_rate_cents: 10000, price_policy: 'override',
        effective_period_start: '2027-02-01', version: 1, superseded_by: departed, superseded_by_name: null },
    ]);
    await mount();
    await screen.findByText('Glinda Good');
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('Unknown user').getAttribute('title')).toBe(departed);
    expect(screen.queryByText(replacer)).toBeNull();
  });
  it('opts into a mid-period true-up, shows the proration, and submits the resolved boundary', async () => {
    await mount();
    fireEvent.change(document.querySelector('#recurring-quantity-config')!, { target: { value: '23' } });
    fireEvent.click(document.querySelector('#recurring-mid-period-config')!);
    // The toggle defaults to the covered start; choose a date inside the period.
    fireEvent.change(document.querySelector('#recurring-mid-period-date-config')!, { target: { value: '2027-01-16' } });
    await waitFor(() => expect(actions.resolve).toHaveBeenCalledWith(expect.objectContaining({ mid_period_date: '2027-01-16' })));
    // 3 x $120 x 16/31 -> the displayed math names the charge and the standing boundary.
    await screen.findByText(/From D\(2027-02-01\) the standing quantity is 23/);
    expect(screen.getByText(/Affected period D\(2027-01-01\) to D\(2027-02-01\) changes by 3 units/)).toBeTruthy();
    expect(screen.getByText(/3 units × \$120\.00/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith(expect.objectContaining({
      allow_mid_period: true,
      mid_period_effective_date: '2027-01-16',
      effective_period_start: '2027-02-01',
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Schedule change' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 23,
      allow_mid_period: true,
      mid_period_effective_date: '2027-01-16',
      effective_period_start: '2027-02-01',
    })));
  });
  it('renders every displayed date through the tenant formatter while the wire values stay ISO', async () => {
    actions.read.mockResolvedValue({ quantity: 20, pricePolicy: 'catalog', unitRateCents: null,
      resolvedUnitRateCents: 10000, catalogUnitRateCents: 10000, baselineQuantity: 20,
      baselineUnitRateCents: 10000, currencyCode: 'USD', source: 'revision', version: 2,
      effectivePeriodStart: '2027-01-01', coveredStart: '2027-01-01', coveredEnd: '2027-02-01',
      catalogPriceId: 'price-1', catalogEffectiveDate: '2026-12-15' });
    actions.revisions.mockResolvedValue([{ revision_id: 'r1', quantity: 30, unit_rate_cents: 12000, price_policy: 'override',
      version: 2, effective_period_start: '2027-02-01', mid_period_effective_date: '2027-01-16',
      created_by: null, updated_by: null, created_by_name: null, updated_by_name: null }]);
    actions.history.mockResolvedValue([{ history_id: 'h1', revision_id: 'r1', quantity: 25, unit_rate_cents: 11000,
      price_policy: 'override', effective_period_start: '2027-03-01', version: 1, superseded_by: 'system', superseded_by_name: null }]);
    actions.preview.mockResolvedValue({ success: true, windowStart: '2027-02-01', windowEnd: '2027-03-01',
      before: { total: 1000, currencyCode: 'USD' }, after: { subtotal: 1000, tax: 0, total: 1000, currencyCode: 'USD', items: [] } });
    const panelText = () => document.body.textContent ?? '';
    await mount();
    await screen.findByText(/A scheduled change is already in force from D\(2027-01-01\)/);
    expect(screen.getByText(/In force for periods from D\(2027-01-01\)/)).toBeTruthy();
    expect(screen.getByText(/Covers D\(2027-01-01\) to D\(2027-02-01\)/)).toBeTruthy();
    expect(screen.getByText(/Catalog price price-1 effective D\(2026-12-15\)/)).toBeTruthy();
    expect(screen.getByText(/From D\(2027-01-01\) the recurring subtotal/)).toBeTruthy();
    // Revisions table: the Effective-from cell and the true-up note.
    expect(screen.getByText('true-up from D(2027-01-16)')).toBeTruthy();
    expect(screen.getAllByText(/D\(2027-02-01\)/).length).toBeGreaterThan(0);
    // History table lives in a collapsed <details>, which is still in the DOM.
    expect(screen.getByText('D(2027-03-01)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));
    await screen.findByText(/Estimated client invoice for D\(2027-02-01\) to D\(2027-03-01\)/);

    fireEvent.change(document.querySelector('#recurring-quantity-config')!, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /Schedule change|Replace scheduled change/ }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ effective_period_start: '2027-01-01' })));
    await screen.findByText('Scheduled: 21 effective D(2027-01-01).');

    // The date inputs carry the ISO wire value (through the picker shim); no other raw ISO text remains.
    expect(panelText().replace(/D\(\d{4}-\d{2}-\d{2}\)/g, '')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('shows preview errors without inventing a total', async () => {
    actions.preview.mockResolvedValue({ success: false, error: 'Prepare service periods in Billing.' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));
    await screen.findByText('Prepare service periods in Billing.');
    expect(screen.queryByText(/Subtotal after discounts/)).toBeNull();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Read, not imported: a static JSON import from server/ records a
// @alga-psa/billing -> server project edge and closes a dependency cycle.
const enContracts = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../server/public/locales/en/msp/contracts.json'), 'utf8'),
);

const actions = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn(), revisions: vi.fn(), history: vi.fn(), resolve: vi.fn() }));
vi.mock('@alga-psa/billing/actions/contractLineUnitPricingActions', () => ({
  getEffectiveRecurringUnitPricing: actions.read,
  scheduleRecurringUnitPricingRevision: actions.save,
  listRecurringUnitPricingRevisions: actions.revisions,
  listRecurringUnitPricingRevisionHistory: actions.history,
  resolveRecurringUnitMidPeriod: actions.resolve,
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({ getNextContractServiceBoundary: async () => '2026-10-01' }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ previewRecurringRevisionInvoiceImpact: actions.preview }));

// Load the real English pack so a localized value that overrides the component's
// conditional defaultValue is exercised. A defaultValue-echoing mock cannot
// reproduce the bug where one key's translation shadowed the mid-period branch.
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { useTranslation } = await import('react-i18next');
  const { formatDateValue } = await import('@alga-psa/ui/lib/i18n/formatDateValue');
  const { countryDateFormat } = await import('@alga-psa/core/i18n/countryDateFormat');
  return {
    useTranslation: (namespace?: string | string[]) => useTranslation(namespace as any),
    useFormatters: () => ({
      formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
      // The tenant's country decides the order: AU writes day first.
      formatDate: (value: string) => formatDateValue(value, 'en', undefined, countryDateFormat('AU')),
    }),
  };
});

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

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['msp/contracts'],
    defaultNS: 'msp/contracts',
    resources: { en: { 'msp/contracts': enContracts } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  actions.read.mockResolvedValue({
    quantity: 23, pricePolicy: 'override', unitRateCents: 10000,
    resolvedUnitRateCents: 10000, catalogUnitRateCents: 10000, baselineQuantity: 23,
    baselineUnitRateCents: 10000, currencyCode: 'USD', coveredStart: '2026-10-01', coveredEnd: '2026-11-01',
  });
  actions.save.mockResolvedValue({ revision_id: 'revision', version: 1 });
  actions.revisions.mockResolvedValue([]);
  actions.history.mockResolvedValue([]);
  actions.resolve.mockResolvedValue({ periodStart: '2026-10-01', periodEnd: '2026-11-01',
    previousQuantity: 23, unitRateCents: 10000, pricePolicy: 'override', currencyCode: 'USD' });
  actions.preview.mockResolvedValue({
    success: true, windowStart: '2026-10-01', windowEnd: '2026-11-01',
    before: { total: 230000, currencyCode: 'USD' },
    after: { subtotal: 244484, tax: 0, total: 244484, currencyCode: 'USD',
      items: [{ id: 'trueup', description: 'Mid-period quantity change', total: 15484 }] },
  });
});

async function mount() {
  render(<RecurringUnitSchedulePanel contractLineId="line" serviceId="service" configId="config" currencyCode="USD" />);
  await waitFor(() => expect((document.querySelector('#recurring-quantity-config') as HTMLInputElement)?.value).toBe('23'));
}

describe('Recurring unit schedule panel (loaded translations)', () => {
  it('shows the resolved standing boundary and the true-up preview for an October 16 mid-period change', async () => {
    await mount();
    fireEvent.change(document.querySelector('#recurring-quantity-config')!, { target: { value: '26' } });
    fireEvent.click(document.querySelector('#recurring-mid-period-config')!);
    fireEvent.change(document.querySelector('#recurring-mid-period-date-config')!, { target: { value: '2026-10-16' } });

    await waitFor(() => expect(actions.resolve).toHaveBeenCalledWith(expect.objectContaining({ mid_period_date: '2026-10-16' })));

    // The standing change begins on the resolved next boundary (2026-11-01),
    // not the 2026-10-16 true-up date.
    await waitFor(() => expect((document.querySelector('#recurring-effective-config') as HTMLInputElement).value).toBe('2026-11-01'));
    await screen.findByText(/From 01\/11\/2026 the standing quantity is 26/);
    // 3 units x $100 x 16/31 days -> $154.84 charge, matching the reproduction.
    expect(screen.getByText(/3 units × \$100\.00 × 16\/31 days = \$154\.84 charge/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));

    // The localized mid-period value says the one-time true-up is included...
    await screen.findByText(/Includes other items in this billing window and the one-time mid-period true-up/);
    // ...and the boundary-only "no mid-period adjustment" copy is gone.
    expect(screen.queryByText(/no mid-period adjustment/)).toBeNull();
  });

  it('keeps the boundary-only preview copy accurate when the true-up is off', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview invoice impact' }));

    await screen.findByText(/Includes other items in this billing window; no mid-period adjustment/);
    expect(screen.queryByText(/Includes other items in this billing window and the one-time mid-period true-up/)).toBeNull();
    // With no true-up, the effective boundary is the selected boundary itself.
    expect((document.querySelector('#recurring-effective-config') as HTMLInputElement).value).toBe('2026-10-01');
  });
});

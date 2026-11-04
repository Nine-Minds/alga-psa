/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const localeRoot = path.resolve(__dirname, '../../../../../server/public/locales');
const enBilling = JSON.parse(readFileSync(path.join(localeRoot, 'en/features/billing.json'), 'utf8'));
const deBilling = JSON.parse(readFileSync(path.join(localeRoot, 'de/features/billing.json'), 'utf8'));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...await importOriginal(),
  useFormatters: () => ({
    formatDate: (d: string | Date, o?: any) => formatDateValue(d, 'en', o),
    formatCalendarDate: (d: string | Date, o?: any) => formatDateValue(d, 'en', o),
  }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/hooks/useQuoteEnumOptions', () => ({
  useFormatQuoteStatus: () => (s: string) => s,
}));
vi.mock('@alga-psa/ui/editor', () => ({
  QuoteTermsContent: () => null,
  hasQuoteTermsContent: () => false,
}));

import { formatDateValue } from '../../../../ui/src/lib/i18n/formatDateValue';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { QuoteDocumentView } from './QuoteDocumentView';

afterEach(cleanup);

let testI18n: ReturnType<typeof createInstance>;

beforeEach(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    ns: ['features/billing'],
    defaultNS: 'features/billing',
    resources: {
      en: { 'features/billing': enBilling },
      de: { 'features/billing': deBilling },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const quote = {
  quote_id: 'q1',
  quote_number: 'Q-100',
  title: 'Network refresh',
  currency_code: 'EUR',
  status: 'sent' as const,
};
const items = [
  {
    quote_item_id: 'i1',
    quote_id: 'q1',
    description: 'Firewall',
    quantity: 1,
    unit_price: 123456,
    total_price: 123456,
    display_order: 0,
    is_optional: false,
    is_selected: true,
  },
] as any;
const totals = { subtotal: 123456, discountTotal: 0, tax: 0, totalAmount: 123456 };

describe('QuoteDocumentView', () => {
  it('renders from props alone with the quote currency symbol (EUR, not USD)', () => {
    const { container } = render(
      <I18nextProvider i18n={testI18n}>
        <CurrencyFormatProvider currencyCode="USD" locale="en">
          <QuoteDocumentView quote={quote} items={items} locations={[]} totals={totals} pdfHref="/api/quote/x/pdf" />
        </CurrencyFormatProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText('Network refresh')).toBeTruthy();
    expect(screen.getByText('Firewall')).toBeTruthy();
    expect(container.textContent).toContain('€');
    expect(container.textContent).not.toContain('$');
    expect(container.querySelector('a[href="/api/quote/x/pdf"]')).toBeTruthy();
  });

  it('renders no switches without onToggle, and slots in order', () => {
    const { container } = render(
      <CurrencyFormatProvider currencyCode="JPY" locale="en">
        <I18nextProvider i18n={testI18n}>
          <QuoteDocumentView
            quote={{ ...quote, currency_code: 'JPY' }}
            items={items}
            locations={[]}
            totals={totals}
            topSlot={<div id="top">top</div>}
            footerSlot={<div id="foot">foot</div>}
          />
        </I18nextProvider>
      </CurrencyFormatProvider>,
    );
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('#top')).toBeTruthy();
    expect(container.querySelector('#foot')).toBeTruthy();
    expect(container.textContent).toContain('¥');
  });

  it('renders date-only fields as the calendar day in UTC-negative browsers', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { container } = render(
        <I18nextProvider i18n={testI18n}>
        <CurrencyFormatProvider currencyCode="EUR" locale="en">
          <QuoteDocumentView
            quote={{ ...quote, quote_date: '2026-12-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z' }}
            items={items} locations={[]} totals={totals}
          />
        </CurrencyFormatProvider>
        </I18nextProvider>,
      );
      expect(container.textContent).toContain('December 31, 2026');
      expect(container.textContent).toContain('December 1, 2026');
      expect(container.textContent).not.toContain('December 30, 2026');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
  it.each([
    ['en', 'Quote'],
    ['de', 'Angebot'],
  ])('renders an unnumbered public quote with the real %s title translation', async (locale, expectedTitle) => {
    await testI18n.changeLanguage(locale);
    render(
      <I18nextProvider i18n={testI18n}>
        <CurrencyFormatProvider currencyCode="EUR" locale={locale}>
          <QuoteDocumentView
            quote={{ title: 'Unnumbered network refresh', currency_code: 'EUR', status: 'sent' }}
            items={[]}
            locations={[]}
            totals={{ subtotal: 0, discountTotal: 0, tax: 0, totalAmount: 0 }}
          />
        </CurrencyFormatProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: expectedTitle })).toBeTruthy();
    expect(screen.queryByText(/\{\{id\}\}/)).toBeNull();
  });

  it.each([
    ['en', 'Quote ABCDEF12'],
    ['de', 'Angebot ABCDEF12'],
  ])('preserves the authenticated portal fallback with the real %s title translation', async (locale, expectedTitle) => {
    await testI18n.changeLanguage(locale);
    render(
      <I18nextProvider i18n={testI18n}>
        <CurrencyFormatProvider currencyCode="EUR" locale={locale}>
          <QuoteDocumentView
            quote={{ quote_id: 'ABCDEF12-3456', title: 'Network refresh', currency_code: 'EUR', status: 'sent' }}
            items={[]}
            locations={[]}
            totals={{ subtotal: 0, discountTotal: 0, tax: 0, totalAmount: 0 }}
          />
        </CurrencyFormatProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: expectedTitle })).toBeTruthy();
  });
});

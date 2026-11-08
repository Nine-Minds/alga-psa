// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const formatting = vi.hoisted(() => ({ timeZone: 'America/New_York', locale: 'en-US', country: 'US' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../src/actions/quoteActions', () => ({
  getQuoteApprovalSettings: async () => ({ approvalRequired: false }),
  updateQuoteApprovalSettings: vi.fn(),
  listQuotes: async () => ({ data: [{
    quote_id: 'quote-1', display_quote_number: 'Q-1001', title: 'Office support',
    client_name: 'Example Client', status: 'pending_approval',
    total_amount: 12345, currency_code: 'EUR',
    quote_date: '2026-12-31T00:00:00.000Z', valid_until: '2027-01-15T00:00:00.000Z',
  }, {
    quote_id: 'quote-2', display_quote_number: 'Q-1002', title: 'No dates',
    total_amount: 0, currency_code: 'EUR', quote_date: null, valid_until: null,
  }] }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { formatCalendarDateValue, formatDateValue } = await import('@alga-psa/ui/lib/i18n/formatDateValue');
  const { countryDateFormat } = await import('@alga-psa/core/i18n/countryDateFormat');
  return {
    useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
    useFormatters: () => ({
      formatCurrency: (value: number, currency: string) =>
        new Intl.NumberFormat(formatting.locale, { style: 'currency', currency }).format(value),
      formatDate: (value: string) => formatDateValue(value, formatting.locale, { timeZone: formatting.timeZone }, countryDateFormat(formatting.country)),
      formatCalendarDate: (value: string) =>
        formatCalendarDateValue(value, formatting.locale, { timeZone: formatting.timeZone }, countryDateFormat(formatting.country)),
    }),
  };
});

// Keep the dashboard's real column renderers while omitting unrelated table controls.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{ dataIndex: string; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }>;
  }) => <table><tbody>{data.map((row) => (
    <tr key={String(row.quote_id)}>{columns.map((column) => (
      <td key={column.dataIndex}>{column.render?.(row[column.dataIndex], row)}</td>
    ))}</tr>
  ))}</tbody></table>,
}));

vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({
  default: ({ clientName }: { clientName: string }) => <span>{clientName}</span>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => null }));
vi.mock('../../src/components/billing-dashboard/quotes/QuoteDetail', () => ({ default: () => null }));
vi.mock('../../src/components/billing-dashboard/quotes/QuoteSoleApproverNotice', () => ({ default: () => null }));
vi.mock('../../src/components/billing-dashboard/quotes/QuoteStatusBadge', () => ({ default: () => null }));

import QuoteApprovalDashboard from '../../src/components/billing-dashboard/quotes/QuoteApprovalDashboard';

afterEach(cleanup);

describe('quote approval dates', () => {
  it.each([
    ['America/New_York', 'en-US', 'US', '12/31/2026', '01/15/2027'],
    ['Pacific/Honolulu', 'en-US', 'US', '12/31/2026', '01/15/2027'],
    ['Pacific/Kiritimati', 'en-US', 'US', '12/31/2026', '01/15/2027'],
    ['America/New_York', 'de-DE', 'DE', '31.12.2026', '15.01.2027'],
  ])('preserves calendar days for %s viewers using %s in %s', async (timeZone, locale, country, quoteDate, validUntil) => {
    Object.assign(formatting, { timeZone, locale, country });
    render(<QuoteApprovalDashboard embedded />);

    const row = (await screen.findByText('Q-1001')).closest('tr');
    if (!row) throw new Error('Expected the loaded quote in a table row');
    expect(within(row).getByText(quoteDate)).toBeDefined();
    expect(within(row).getByText(validUntil)).toBeDefined();
    expect(within(row).getAllByRole('cell')[3].textContent).toBe(new Intl.NumberFormat(locale, {
      style: 'currency', currency: 'EUR',
    }).format(123.45));

    const emptyRow = screen.getByText('Q-1002').closest('tr');
    if (!emptyRow) throw new Error('Expected the undated quote in a table row');
    const cells = within(emptyRow).getAllByRole('cell');
    expect(cells[5].textContent).toBe('—');
    expect(cells[6].textContent).toBe('—');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftsTab from '../src/components/billing-dashboard/invoicing/DraftsTab';

const mocks = vi.hoisted(() => ({
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue;
    return typeof template === 'string' ? template : key;
  },
  fetchInvoicesPaginated: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: any) => <div>{children}</div>,
  Panel: ({ children }: any) => <div>{children}</div>,
  PanelResizeHandle: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en' } }),
  useFormatters: () => ({
    formatCurrency: (v: number) => `$${v}`,
    formatDate: (v: string) => v,
  }),
}));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: mocks.fetchInvoicesPaginated,
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  finalizeInvoice: vi.fn(),
  hardDeleteInvoice: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/taxSourceActions', () => ({
  validateInvoiceFinalization: vi.fn(),
  updateInvoiceTaxSource: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ downloadInvoicePDF: vi.fn() }));
vi.mock('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel', () => ({
  default: () => null,
}));
vi.mock('../src/components/invoices/InvoiceSyncBadge', () => ({
  InvoiceSyncBadge: () => <span data-testid="sync-badge" />,
}));
vi.mock('../src/components/invoices/useInvoiceSyncStatuses', () => ({
  useInvoiceSyncStatuses: (ids: string[]) => ({
    statuses: Object.fromEntries(ids.map((id) => [id, { status: 'synced', environment: 'sandbox' }])),
    loading: false,
    hidden: false,
  }),
}));

const invoice = (id: string, num: string) => ({
  invoice_id: id,
  invoice_number: num,
  client: { name: 'Emerald City' },
  total_amount: 1000,
  invoice_date: '2026-10-01',
  due_date: '2026-10-31',
  status: 'draft',
  currencyCode: 'USD',
});

describe('DraftsTab render contract', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.fetchInvoicesPaginated.mockResolvedValue({
      invoices: [invoice('inv-1', 'DRAFT-1'), invoice('inv-2', 'DRAFT-2')],
      total: 2,
    });
  });
  afterEach(() => {
    cleanup();
    warn.mockRestore();
  });

  const renderTab = async () => {
    render(<DraftsTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);
    await waitFor(() => expect(document.querySelector('#draft-row-actions-inv-1')).not.toBeNull());
  };

  it('renders one selection column and an Actions trigger per row', async () => {
    await renderTab();
    expect(document.querySelectorAll('[id^="draft-row-actions-"]')).toHaveLength(2);
    expect(document.querySelectorAll('#select-all-drafts')).toHaveLength(1);
    expect(document.querySelectorAll('[id^="draft-inv-"]')).toHaveLength(2);
    // Header holds exactly one checkbox; each body row holds exactly one.
    expect(document.querySelectorAll('thead input[type="checkbox"], thead [role="checkbox"]')).toHaveLength(1);
    document.querySelectorAll('tbody tr').forEach((row) => {
      expect(row.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).toHaveLength(1);
    });
  });

  it('renders the QuickBooks sync badge column', async () => {
    await renderTab();
    expect(screen.getAllByTestId('sync-badge')).toHaveLength(2);
  });

  it('does not log a duplicate column id warning', async () => {
    await renderTab();
    const dupes = warn.mock.calls.filter((c) => String(c[0]).includes('share the same column id'));
    expect(dupes).toHaveLength(0);
  });

  it('opens the Actions menu', async () => {
    await renderTab();
    await userEvent.click(document.querySelector('#draft-row-actions-inv-1') as HTMLElement);
    expect(await screen.findByText('Finalize')).toBeTruthy();
  });
});

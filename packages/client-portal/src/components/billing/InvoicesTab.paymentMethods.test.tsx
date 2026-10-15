/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InvoicesTab from './InvoicesTab';

const mocks = vi.hoisted(() => ({
  getClientInvoices: vi.fn(),
  searchParams: new URLSearchParams('invoiceId=invoice-1'),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoices: mocks.getClientInvoices,
  downloadClientInvoicePdf: vi.fn(),
  sendClientInvoiceEmail: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      {data.map((record: any) => (
        <div key={record.invoice_id}>
          {columns.map((column: any, index: number) => (
            <div key={index}>{column.render?.(record[column.dataIndex], record)}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => <div>loading</div> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('./ClientInvoicePreview', () => ({ default: () => <div>invoice preview</div> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const invoice = (payment_method: string | null) => ({
  invoice_id: 'invoice-1',
  invoice_number: 'INV-001',
  invoice_date: '2026-09-01',
  due_date: '2026-09-30',
  total: 10000,
  credit_applied: 0,
  currencyCode: 'USD',
  finalized_at: '2026-09-01T00:00:00Z',
  payment_method,
  invoice_type: 'standard',
});

async function renderInvoice(paymentMethod: string | null) {
  mocks.getClientInvoices.mockResolvedValue([invoice(paymentMethod)]);
  render(<InvoicesTab formatCurrency={(amount) => String(amount)} formatDate={(date) => String(date)} />);
  await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
}

describe('InvoicesTab Pay Now controls by invoice payment method', () => {
  it.each(['check', 'bank_transfer'])('omits Pay Now from the invoice menu and details for %s', async (method) => {
    await renderInvoice(method);

    expect(screen.queryByText('Pay Now')).not.toBeInTheDocument();
    expect(document.querySelector('[id^="pay-invoice-"]')).toBeNull();
  });

  it('retains Pay Now for Credit Card invoices in the menu and details', async () => {
    await renderInvoice('credit_card');

    await waitFor(() => expect(screen.getAllByText('Pay Now')).toHaveLength(2));
    expect(document.querySelector('#pay-invoice-INV-001')).toBeInTheDocument();
    expect(document.querySelector('#pay-invoice-INV-001-menu-item')).toBeInTheDocument();
  });

  it('preserves Pay Now for invoices with no payment-method snapshot', async () => {
    await renderInvoice(null);

    await waitFor(() => expect(screen.getAllByText('Pay Now')).toHaveLength(2));
  });
});

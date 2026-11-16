/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InvoicesTab from './InvoicesTab';

const mocks = vi.hoisted(() => {
  const translate = (key: string, fallback?: string | Record<string, string>) => {
    if (key === 'invoice.autopayWillCharge') {
      return 'Will be charged on {{date}} to {{brand}} •••• {{last4}}'.replace(
        /\{\{(date|brand|last4)\}\}/g,
        (_match, name) => String((fallback as Record<string, string>)[name])
      );
    }
    const known: Record<string, string> = { 'invoice.finalized': 'Finalized', 'invoice.draft': 'Draft' };
    if (known[key]) return known[key];
    return typeof fallback === 'string' ? fallback : key;
  };
  return { translate, getClientInvoices: vi.fn(), getInvoiceAutopayContexts: vi.fn() };
});

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <table><tbody>
      {data.map((record: any) => (
        <tr key={record.invoice_id}>
          {columns.map((column: any) => (
            <td key={column.dataIndex}>
              {column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]}
            </td>
          ))}
        </tr>
      ))}
    </tbody></table>
  ),
}));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => <div>Loading</div> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/client-portal/actions', () => ({ getClientInvoices: mocks.getClientInvoices, downloadClientInvoicePdf: vi.fn(), sendClientInvoiceEmail: vi.fn() }));
vi.mock('@alga-psa/billing/actions/paymentActions', () => ({ getInvoiceAutopayContexts: mocks.getInvoiceAutopayContexts }));
vi.mock('./ClientInvoicePreview', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (overrides: Record<string, unknown>) => ({
  invoice_id: 'inv-1',
  invoice_number: 'INV-001',
  invoice_date: '2026-09-01',
  total: 1000,
  currencyCode: 'USD',
  credit_applied: 0,
  invoice_type: 'standard',
  finalized_at: '2026-09-01',
  ...overrides,
});

const renderTab = () =>
  render(<InvoicesTab formatCurrency={(amount) => `$${amount}`} formatDate={(date) => String(date)} />);

describe('InvoicesTab voided invoices', () => {
  it('shows Voided instead of Finalized for a cancelled invoice', async () => {
    mocks.getClientInvoices.mockResolvedValue([row({ status: 'cancelled' })]);
    mocks.getInvoiceAutopayContexts.mockResolvedValue({});

    renderTab();

    expect(await screen.findByText('Voided')).toBeInTheDocument();
    expect(screen.queryByText('Finalized')).toBeNull();
  });

  it('keeps a live finalized invoice showing Finalized', async () => {
    mocks.getClientInvoices.mockResolvedValue([row({ status: 'sent' })]);
    mocks.getInvoiceAutopayContexts.mockResolvedValue({});

    renderTab();

    expect(await screen.findByText('Finalized')).toBeInTheDocument();
    expect(screen.queryByText('Voided')).toBeNull();
  });

  it('never advertises an autopay charge or offers Pay on a voided invoice', async () => {
    mocks.getClientInvoices.mockResolvedValue([row({ status: 'cancelled' })]);
    mocks.getInvoiceAutopayContexts.mockResolvedValue({
      'inv-1': { scheduledFor: '2026-09-30', brand: 'Visa', last4: '4242', status: 'scheduled' },
    });

    renderTab();

    await screen.findByText('INV-001');
    await waitFor(() => expect(mocks.getInvoiceAutopayContexts).toHaveBeenCalledWith(['inv-1']));

    expect(screen.queryByText(/Will be charged on/)).toBeNull();
    expect(screen.queryByText('Voided – not payable')).not.toBeNull();
  });

  it('still advertises the autopay charge on a live finalized invoice', async () => {
    mocks.getClientInvoices.mockResolvedValue([row({ status: 'sent' })]);
    mocks.getInvoiceAutopayContexts.mockResolvedValue({
      'inv-1': { scheduledFor: '2026-09-30', brand: 'Visa', last4: '4242', status: 'scheduled' },
    });

    renderTab();

    expect(await screen.findByText('Will be charged on 2026-09-30 to Visa •••• 4242')).toBeInTheDocument();
  });
});

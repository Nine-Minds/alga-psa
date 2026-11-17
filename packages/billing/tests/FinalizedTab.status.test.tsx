// @vitest-environment jsdom

/**
 * The Finalized tab's Status column used to render a hard-coded "Finalized"
 * badge for every row, so an invoice Stripe had already settled still read as
 * Finalized and the MSP concluded nothing had synced (alga-2026-0003329).
 * These tests pin the real status per row and the Record Payment row action
 * that goes with it.
 */
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  fetchInvoicesPaginated: vi.fn(),
  translate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: mocks.fetchInvoicesPaginated,
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({ getInvoiceTemplates: vi.fn().mockResolvedValue([]) }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ unfinalizeInvoice: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ downloadInvoicePDF: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({ scheduleInvoiceZipAction: vi.fn() }));
vi.mock('@alga-psa/billing/actions/paymentActions', () => ({ getInvoiceAutopayContexts: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate }),
  useFormatters: () => ({ locale: 'en-US', formatCurrency: (value: number) => `$${value}`, formatDate: () => 'today' }),
}));
vi.mock('@alga-psa/ui/hooks', () => ({ useRangeSelection: () => ({ isSelected: () => false, handleSelect: vi.fn() }) }));
vi.mock('../src/components/invoices/useInvoiceSyncStatuses', () => ({ useInvoiceSyncStatuses: () => ({ statuses: {}, hidden: true }) }));
vi.mock('../src/components/invoices/InvoiceSyncBadge', () => ({ InvoiceSyncBadge: () => null }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <div>Loading</div> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({ BulkActionBar: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, variant }: React.PropsWithChildren<{ variant?: string }>) => (
    <span data-variant={variant}>{children}</span>
  ),
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PanelGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PanelResizeHandle: () => null,
}));
vi.mock('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog', () => ({ SendInvoiceEmailDialog: () => null }));
vi.mock('../src/components/billing-dashboard/invoicing/RecordPaymentDialog', () => ({
  RecordPaymentDialog: ({ isOpen, invoiceNumber }: { isOpen: boolean; invoiceNumber?: string }) => (
    isOpen ? <div role="dialog">Record payment for {invoiceNumber}</div> : null
  ),
}));

// Render each row's cells so the column render functions actually run.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns = [] }: { data: any[]; columns?: any[] }) => (
    <table>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.invoice_id} data-testid={`row-${row.invoice_id}`}>
            {columns.map((column: any, index: number) => {
              const dataIndex = column.dataIndex;
              const value = typeof dataIndex === 'string' ? row[dataIndex] : undefined;
              return (
                <td key={`${row.invoice_id}-${index}`}>
                  {column.render ? column.render(value, row, 0) : String(value ?? '')}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import FinalizedTab from '../src/components/billing-dashboard/invoicing/FinalizedTab';
import {
  canRecordPaymentForInvoice,
  canRecordPaymentForStatus,
  invoiceStatusBadgeVariant,
} from '../src/components/billing-dashboard/invoicing/FinalizedTab';

const invoice = (overrides: Record<string, unknown>) => ({
  invoice_id: 'inv-1',
  invoice_number: 'INV-000008',
  client: { name: 'JRM360' },
  total_amount: 100,
  credit_applied: 0,
  currencyCode: 'USD',
  finalized_at: '2026-11-10T00:00:00.000Z',
  status: 'sent',
  ...overrides,
});

async function renderWith(invoices: Array<Record<string, unknown>>) {
  mocks.fetchInvoicesPaginated.mockResolvedValue({ invoices, total: invoices.length });
  render(<FinalizedTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);
  return screen.findByTestId(`row-${invoices[0].invoice_id}`);
}

describe('FinalizedTab status column', () => {
  beforeEach(() => {
    mocks.translate.mockImplementation((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Paid for an invoice Stripe already settled, not a hard-coded Finalized', async () => {
    const row = await renderWith([invoice({ status: 'paid' })]);

    expect(within(row).getByText('Paid')).toBeInTheDocument();
    expect(within(row).queryByText('Finalized')).not.toBeInTheDocument();
    expect(within(row).getByText('Paid')).toHaveAttribute('data-variant', 'success');
  });

  it('shows the real status for sent, partially paid and overdue rows', async () => {
    const rows = [
      invoice({ invoice_id: 'inv-sent', status: 'sent' }),
      invoice({ invoice_id: 'inv-partial', status: 'partially_applied' }),
      invoice({ invoice_id: 'inv-overdue', status: 'overdue' }),
    ];
    await renderWith(rows);

    expect(within(screen.getByTestId('row-inv-sent')).getByText('Sent')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-inv-partial')).getByText('Partially Applied')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-inv-overdue')).getByText('Overdue')).toBeInTheDocument();
  });

  it('offers Record Payment on an unpaid invoice and hides it once paid or cancelled', async () => {
    const rows = [
      invoice({ invoice_id: 'inv-sent', status: 'sent' }),
      invoice({ invoice_id: 'inv-paid', status: 'paid' }),
      invoice({ invoice_id: 'inv-cancelled', status: 'cancelled' }),
    ];
    await renderWith(rows);

    expect(within(screen.getByTestId('row-inv-sent')).getByText('Record Payment')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-inv-paid')).queryByText('Record Payment')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('row-inv-cancelled')).queryByText('Record Payment')).not.toBeInTheDocument();
  });

  it('maps every status to a badge variant and to the right Record Payment eligibility', () => {
    expect(invoiceStatusBadgeVariant('paid')).toBe('success');
    expect(invoiceStatusBadgeVariant('partially_applied')).toBe('warning');
    expect(invoiceStatusBadgeVariant('overdue')).toBe('error');
    expect(invoiceStatusBadgeVariant('cancelled')).toBe('secondary');
    expect(invoiceStatusBadgeVariant('sent')).toBe('default-muted');
    expect(invoiceStatusBadgeVariant(undefined)).toBe('default-muted');

    expect(canRecordPaymentForStatus('sent')).toBe(true);
    expect(canRecordPaymentForStatus('partially_applied')).toBe(true);
    expect(canRecordPaymentForStatus('overdue')).toBe(true);
    for (const status of ['draft', 'paid', 'cancelled', 'void']) {
      expect(canRecordPaymentForStatus(status)).toBe(false);
    }
  });

  // The row gate must not offer an action the server action will refuse.
  it('offers Record Payment on a row without a finalization timestamp, but not on one covered by credit', () => {
    expect(canRecordPaymentForInvoice(invoice({ status: 'sent', finalized_at: null }) as any)).toBe(true);
    expect(canRecordPaymentForInvoice(invoice({ status: 'sent', total_amount: 100, credit_applied: 100 }) as any)).toBe(false);
    expect(canRecordPaymentForInvoice(invoice({ status: 'sent', total_amount: 0, credit_applied: 0 }) as any)).toBe(false);
  });

  it('keeps the action on a row the tab lists without a finalization timestamp', async () => {
    const row = await renderWith([invoice({ invoice_id: 'inv-unfinalized', status: 'sent', finalized_at: null })]);

    expect(within(row).getByText('Record Payment')).toBeInTheDocument();
  });
});

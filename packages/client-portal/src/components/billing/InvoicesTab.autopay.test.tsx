/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InvoicesTab from './InvoicesTab';

const mocks = vi.hoisted(() => {
  let resolveContexts: ((value: Record<string, unknown>) => void) | undefined;
  const contexts = new Promise<Record<string, unknown>>((resolve) => { resolveContexts = resolve; });
  const translate = (key: string, fallback?: string | Record<string, string>) => {
    if (key !== 'invoice.autopayWillCharge') return typeof fallback === 'string' ? fallback : key;
    return 'Will be charged on {{date}} to {{brand}} •••• {{last4}}'.replace(/\{\{(date|brand|last4)\}\}/g, (_match, name) => String((fallback as Record<string, string>)[name]));
  };
  return { resolveContexts, contexts, translate, getClientInvoices: vi.fn(), getInvoiceAutopayContexts: vi.fn() };
});

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => <table><tbody>{data.map((record: any) => <tr key={record.invoice_id}>{columns.map((column: any) => <td key={column.dataIndex}>{column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]}</td>)}</tr>)}</tbody></table>,
}));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => <div>Loading</div> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({ DropdownMenu: ({ children }: any) => <>{children}</>, DropdownMenuTrigger: ({ children }: any) => <>{children}</>, DropdownMenuContent: ({ children }: any) => <>{children}</>, DropdownMenuItem: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/client-portal/actions', () => ({ getClientInvoices: mocks.getClientInvoices, downloadClientInvoicePdf: vi.fn(), sendClientInvoiceEmail: vi.fn() }));
vi.mock('@alga-psa/billing/actions/paymentActions', () => ({ getInvoiceAutopayContexts: mocks.getInvoiceAutopayContexts }));
vi.mock('./ClientInvoicePreview', () => ({ default: () => null }));

afterEach(() => cleanup());

describe('InvoicesTab auto-pay context', () => {
  it('updates the rendered invoice after autopay contexts resolve', async () => {
    mocks.getClientInvoices.mockResolvedValue([{
      invoice_id: 'inv-1', invoice_number: 'INV-001', finalized_at: '2026-09-01', invoice_date: '2026-09-01', total: 1000, currencyCode: 'USD',
      credit_applied: 0, invoice_type: 'standard',
    }]);
    mocks.getInvoiceAutopayContexts.mockReturnValue(mocks.contexts);

    render(<InvoicesTab formatCurrency={(amount) => `$${amount}`} formatDate={(date) => String(date)} />);
    await waitFor(() => expect(mocks.getInvoiceAutopayContexts).toHaveBeenCalledWith(['inv-1']));

    await act(async () => mocks.resolveContexts?.({ 'inv-1': { scheduledFor: '2026-09-30', brand: 'Visa', last4: '4242', status: 'scheduled' } }));
    await screen.findByText('INV-001');
    expect(await screen.findByText('Will be charged on 2026-09-30 to Visa •••• 4242')).toBeInTheDocument();
  });
});

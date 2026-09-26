// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  fetchInvoicesPaginated: vi.fn(),
  searchParams: new URLSearchParams('invoiceId=deep-linked-invoice'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: mocks.fetchInvoicesPaginated,
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({ getInvoiceTemplates: vi.fn().mockResolvedValue([]) }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ unfinalizeInvoice: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ downloadInvoicePDF: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({ scheduleInvoiceZipAction: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value}`, formatDate: () => 'today' }),
}));
vi.mock('@alga-psa/ui/hooks', () => ({ useRangeSelection: () => ({}) }));
vi.mock('../../src/components/invoices/useInvoiceSyncStatuses', () => ({ useInvoiceSyncStatuses: () => ({ statuses: {}, hidden: true }) }));
vi.mock('../../src/components/invoices/InvoiceSyncBadge', () => ({ InvoiceSyncBadge: () => null }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <div>Loading</div> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({ BulkActionBar: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => <div data-testid="invoice-table" /> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
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
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    MoreVertical: () => null, CheckCircle: () => null, GripVertical: () => null,
    Download: () => null, Mail: () => null, RotateCcw: () => null, Search: () => null,
    ArrowRight: () => null,
  };
});
vi.mock('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel', () => ({
  default: ({ invoiceId, onEmail }: { invoiceId: string | null; onEmail: () => void }) => (
    <div>
      <span>Preview: {invoiceId}</span>
      <button onClick={onEmail}>Send Email</button>
    </div>
  ),
}));
vi.mock('../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog', () => ({
  SendInvoiceEmailDialog: ({ isOpen, invoiceIds }: { isOpen: boolean; invoiceIds: string[] }) => (
    isOpen ? <div role="dialog">Email invoices: {invoiceIds.join(',')}</div> : null
  ),
}));

import FinalizedTab from '../src/components/billing-dashboard/invoicing/FinalizedTab';

describe('FinalizedTab deep-linked invoice email', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams('invoiceId=deep-linked-invoice');
  });

  it('opens Send Email for the displayed invoice even when it is absent from the current page', async () => {
    mocks.fetchInvoicesPaginated.mockResolvedValue({
      invoices: [{ invoice_id: 'another-page-invoice', invoice_number: 'INV-OTHER' }],
      total: 50,
    });

    render(<FinalizedTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);

    expect(await screen.findByText('Preview: deep-linked-invoice')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Email invoices: deep-linked-invoice'));
  });

  it('keeps on-page Send Email behavior for the selected invoice', async () => {
    mocks.fetchInvoicesPaginated.mockResolvedValue({
      invoices: [{ invoice_id: 'deep-linked-invoice', invoice_number: 'INV-SELECTED' }],
      total: 1,
    });

    render(<FinalizedTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);

    expect(await screen.findByText('Preview: deep-linked-invoice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Email invoices: deep-linked-invoice');
  });
});

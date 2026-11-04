// @vitest-environment jsdom

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { createInstance } from 'i18next';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  fetchInvoicesPaginated: vi.fn(),
  unfinalizeInvoice: vi.fn(),
  translate: vi.fn(),
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
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ unfinalizeInvoice: mocks.unfinalizeInvoice }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ downloadInvoicePDF: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({ scheduleInvoiceZipAction: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate }),
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value}`, formatDate: () => 'today' }),
}));
vi.mock('@alga-psa/ui/hooks', () => ({ useRangeSelection: () => ({}) }));
vi.mock('../src/components/invoices/useInvoiceSyncStatuses', () => ({ useInvoiceSyncStatuses: () => ({ statuses: {}, hidden: true }) }));
vi.mock('../src/components/invoices/InvoiceSyncBadge', () => ({ InvoiceSyncBadge: () => null }));
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
  default: ({ invoiceId, onEmail, onUnfinalize }: { invoiceId: string | null; onEmail: () => void; onUnfinalize: () => void }) => (
    <div>
      <span>Preview: {invoiceId}</span>
      <button onClick={onEmail}>Send Email</button>
      <button onClick={onUnfinalize}>Unfinalize invoice</button>
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
  beforeEach(() => {
    mocks.translate.mockImplementation((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key);
  });

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

  it('explains a used block refusal and does not offer the explanation for other errors', async () => {
    mocks.fetchInvoicesPaginated.mockResolvedValue({ invoices: [{ invoice_id: 'deep-linked-invoice', invoice_number: 'INV-SELECTED' }], total: 1 });
    mocks.unfinalizeInvoice.mockResolvedValueOnce({ actionError: 'Block already used', messageKey: 'msp/invoicing:errors.invoice.usedHourBlockUnfinalize' })
      .mockResolvedValueOnce({ actionError: 'Invoice is exported' });
    render(<FinalizedTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);
    await screen.findByText('Preview: deep-linked-invoice');
    await waitFor(() => expect(mocks.fetchInvoicesPaginated).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Unfinalize invoice' }));
    expect(await screen.findByText('Block already used')).toBeInTheDocument();
    const explain = screen.getByRole('button', { name: 'Explain this' });
    expect(explain).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(explain);
    expect(explain).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Time has since been allocated to the block/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unfinalize invoice' }));
    expect(await screen.findByText('Invoice is exported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain this' })).not.toBeInTheDocument();
  });

  it.each([
    ['de', 'Erklärung anzeigen', 'Mit der Finalisierung'],
    ['es', 'Ver explicación', 'Al finalizar esta factura'],
    ['fr', 'Afficher l’explication', 'La finalisation de cette facture'],
    ['it', 'Mostra spiegazione', 'La finalizzazione di questa fattura'],
    ['nl', 'Toelichting tonen', 'Door deze factuur definitief te maken'],
    ['pl', 'Pokaż wyjaśnienie', 'Sfinalizowanie tej faktury'],
    ['pt', 'Ver explicação', 'A finalização desta fatura'],
    ['sv', 'Visa förklaring', 'När denna faktura fastställdes'],
    ['xx', '⟦Ḗẋƥŀȧīƞ ŧħīş⟧', '⟦Ƒīƞȧŀīẑīƞɠ'],
    ['yy', '〖Ḗẋƥŀȧīƞ ŧħīş ·····〗', '〖Ƒīƞȧŀīẑīƞɠ'],
  ])('renders the used-block refusal and expandable explanation in %s', async (locale, label, explanationStart) => {
    const namespace = 'msp/invoicing';
    const pack = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../server/public/locales/${locale}/${namespace}.json`), 'utf8'));
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      defaultNS: namespace,
      resources: { [locale]: { [namespace]: pack } },
      interpolation: { escapeValue: false },
    });
    mocks.translate.mockImplementation(i18n.getFixedT(locale, namespace));
    const messageKey = `${namespace}:errors.invoice.usedHourBlockUnfinalize`;
    const actionError = i18n.t(messageKey, { blockId: 'BLOCK-42', usedHours: 3, totalHours: 10 });
    expect(actionError).toContain('BLOCK-42');
    expect(actionError).toContain('3');
    expect(actionError).toContain('10');
    expect(actionError).not.toContain('{{');
    mocks.fetchInvoicesPaginated.mockResolvedValue({ invoices: [{ invoice_id: 'deep-linked-invoice', invoice_number: 'INV-SELECTED' }], total: 1 });
    mocks.unfinalizeInvoice.mockResolvedValue({ actionError, messageKey });

    render(<FinalizedTab onRefreshNeeded={vi.fn()} refreshTrigger={0} />);
    await screen.findByText('Preview: deep-linked-invoice');
    await waitFor(() => expect(mocks.fetchInvoicesPaginated).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Unfinalize invoice' }));
    expect(await screen.findByText(actionError)).toBeInTheDocument();
    const explain = screen.getByRole('button', { name: label });
    expect(explain).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText((text) => text.startsWith(explanationStart))).not.toBeInTheDocument();
    fireEvent.click(explain);
    expect(explain).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText((text) => text.startsWith(explanationStart))).toBeInTheDocument();
    fireEvent.click(explain);
    expect(explain).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText((text) => text.startsWith(explanationStart))).not.toBeInTheDocument();
  });
});

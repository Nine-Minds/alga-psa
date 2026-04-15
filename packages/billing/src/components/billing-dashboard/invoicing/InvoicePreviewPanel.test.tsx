// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InvoicePreviewPanel from './InvoicePreviewPanel';

const getInvoiceForRenderingMock = vi.fn();
const getInvoicePurchaseOrderSummaryMock = vi.fn();
const getResolvedInvoiceTemplateIdMock = vi.fn();
const getQuoteByConvertedInvoiceIdMock = vi.fn();
const mapDbInvoiceToWasmViewModelMock = vi.fn();
const templateRendererMock = vi.fn();
const paperInvoiceMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getInvoiceForRendering: (...args: unknown[]) => getInvoiceForRenderingMock(...args),
  getInvoicePurchaseOrderSummary: (...args: unknown[]) => getInvoicePurchaseOrderSummaryMock(...args),
  getResolvedInvoiceTemplateId: (...args: unknown[]) => getResolvedInvoiceTemplateIdMock(...args),
}));

vi.mock('@alga-psa/billing/actions/quoteActions', () => ({
  getQuoteByConvertedInvoiceId: (...args: unknown[]) => getQuoteByConvertedInvoiceIdMock(...args),
}));

vi.mock('../../../lib/adapters/invoiceAdapters', () => ({
  mapDbInvoiceToWasmViewModel: (...args: unknown[]) => mapDbInvoiceToWasmViewModelMock(...args),
}));

vi.mock('../TemplateRenderer', () => ({
  TemplateRenderer: (props: any) => {
    templateRendererMock(props);
    return (
      <div data-automation-id="template-renderer-mock">
        {props?.invoiceData?.invoiceNumber ?? 'NO_INVOICE'}::{props?.template?.template_id ?? 'NO_TEMPLATE'}
      </div>
    );
  },
}));

vi.mock('../PaperInvoice', () => ({
  default: (props: { children: React.ReactNode; templateAst?: unknown }) => {
    paperInvoiceMock(props);
    return <div data-automation-id="paper-invoice-mock">{props.children}</div>;
  },
}));

vi.mock('./DraftInvoiceDetailsCard', () => ({
  default: () => <div data-automation-id="draft-invoice-details-card-mock" />,
}));

vi.mock('./PurchaseOrderSummaryBanner', () => ({
  PurchaseOrderSummaryBanner: () => <div data-automation-id="po-summary-banner-mock" />,
}));

vi.mock('../CreditExpirationInfo', () => ({
  default: () => <div data-automation-id="credit-expiration-mock" />,
}));

vi.mock('../../invoices/InvoiceTaxSourceBadge', () => ({
  InvoiceTaxSourceBadge: ({ taxSource }: { taxSource: string }) => (
    <div data-automation-id="invoice-tax-source-badge-mock">{taxSource}</div>
  ),
}));

const defaultTemplates = [
  {
    template_id: 'tpl-first',
    name: 'First Template',
    isStandard: false,
    is_default: false,
  },
  {
    template_id: 'tpl-resolved',
    name: 'Resolved Template',
    isStandard: false,
    is_default: true,
  },
];

const defaultInvoiceData = {
  invoice_id: 'inv-1',
  tax_source: 'internal',
};

const defaultViewModel = {
  invoiceNumber: 'INV-1001',
  issueDate: '2026-04-01',
  dueDate: '2026-04-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'AI Med Consult', address: '123 Main St' },
  tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
  items: [],
  subtotal: 1000,
  tax: 100,
  total: 1100,
};

describe('InvoicePreviewPanel', () => {
  beforeEach(() => {
    cleanup();
    routerPushMock.mockReset();
    getInvoiceForRenderingMock.mockReset();
    getInvoicePurchaseOrderSummaryMock.mockReset();
    getResolvedInvoiceTemplateIdMock.mockReset();
    getQuoteByConvertedInvoiceIdMock.mockReset();
    mapDbInvoiceToWasmViewModelMock.mockReset();
    templateRendererMock.mockReset();
    paperInvoiceMock.mockReset();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    getInvoiceForRenderingMock.mockResolvedValue(defaultInvoiceData);
    getInvoicePurchaseOrderSummaryMock.mockResolvedValue(null);
    getResolvedInvoiceTemplateIdMock.mockResolvedValue('tpl-resolved');
    getQuoteByConvertedInvoiceIdMock.mockResolvedValue(null);
    mapDbInvoiceToWasmViewModelMock.mockReturnValue(defaultViewModel);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the invoice-resolved template when no explicit template is selected', async () => {
    render(
      <InvoicePreviewPanel
        invoiceId="inv-1"
        templates={defaultTemplates as any}
        selectedTemplateId={null}
        onTemplateChange={vi.fn()}
        isFinalized={false}
      />
    );

    await waitFor(() => expect(getResolvedInvoiceTemplateIdMock).toHaveBeenCalledWith('inv-1'));
    expect(await screen.findByText('INV-1001::tpl-resolved')).toBeTruthy();
    expect(templateRendererMock.mock.calls.at(-1)?.[0]?.template?.template_id).toBe('tpl-resolved');
  });

  it('keeps an explicit template selection over the resolved invoice template', async () => {
    render(
      <InvoicePreviewPanel
        invoiceId="inv-1"
        templates={defaultTemplates as any}
        selectedTemplateId="tpl-first"
        onTemplateChange={vi.fn()}
        isFinalized={false}
      />
    );

    expect(await screen.findByText('INV-1001::tpl-first')).toBeTruthy();
    expect(templateRendererMock.mock.calls.at(-1)?.[0]?.template?.template_id).toBe('tpl-first');
  });
});

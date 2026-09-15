// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InvoicePreviewPanel from './InvoicePreviewPanel';

const getEnrichedInvoiceViewModelMock = vi.fn();
const getInvoicePurchaseOrderSummaryMock = vi.fn();
const getResolvedInvoiceTemplateIdMock = vi.fn();
const getInvoiceAnnotationsMock = vi.fn();
const getQuoteByConvertedInvoiceIdMock = vi.fn();
const templateRendererMock = vi.fn();
const paperInvoiceMock = vi.fn();
const routerPushMock = vi.fn();

const releaseFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: releaseFlag.enabled, loading: false, error: null }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange }: any) => (
    <select aria-label="Invoice layout" value={value} onChange={event => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getEnrichedInvoiceViewModel: (...args: unknown[]) => getEnrichedInvoiceViewModelMock(...args),
  getInvoicePurchaseOrderSummary: (...args: unknown[]) => getInvoicePurchaseOrderSummaryMock(...args),
  getResolvedInvoiceTemplateId: (...args: unknown[]) => getResolvedInvoiceTemplateIdMock(...args),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceAnnotations: (...args: unknown[]) => getInvoiceAnnotationsMock(...args),
}));

vi.mock('@alga-psa/billing/actions/quoteActions', () => ({
  getQuoteByConvertedInvoiceId: (...args: unknown[]) => getQuoteByConvertedInvoiceIdMock(...args),
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

// CreditApplicationUI pulls in server actions (next-auth) that cannot load in
// this environment; the panel only mounts it inside the Apply Credit dialog.
vi.mock('../CreditApplicationUI', () => ({
  default: () => <div data-automation-id="credit-application-mock" />,
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

const defaultViewModel = {
  invoiceNumber: 'INV-1001',
  taxSource: 'internal',
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
    releaseFlag.enabled = true;
    cleanup();
    routerPushMock.mockReset();
    getEnrichedInvoiceViewModelMock.mockReset();
    getInvoicePurchaseOrderSummaryMock.mockReset();
    getResolvedInvoiceTemplateIdMock.mockReset();
    getInvoiceAnnotationsMock.mockReset();
    getQuoteByConvertedInvoiceIdMock.mockReset();
    templateRendererMock.mockReset();
    paperInvoiceMock.mockReset();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    getEnrichedInvoiceViewModelMock.mockResolvedValue(defaultViewModel);
    getInvoicePurchaseOrderSummaryMock.mockResolvedValue(null);
    getResolvedInvoiceTemplateIdMock.mockResolvedValue('tpl-resolved');
    getInvoiceAnnotationsMock.mockResolvedValue([]);
    getQuoteByConvertedInvoiceIdMock.mockResolvedValue(null);
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
  it.each([false, true])('offers new by-ticket layouts only with the release flag enabled (%s)', async enabled => {
    releaseFlag.enabled = enabled;
    render(<InvoicePreviewPanel invoiceId="inv-1" selectedTemplateId="tpl-first" onTemplateChange={vi.fn()} isFinalized={false}
      templates={[...defaultTemplates, { template_id: 'by-ticket', name: 'By Ticket', isStandard: true, standard_invoice_template_code: 'standard-invoice-by-ticket' }] as any} />);
    await screen.findByText('INV-1001::tpl-first');
    const options = Array.from((screen.getByRole('combobox', { name: 'Invoice layout' }) as HTMLSelectElement).options, option => option.value);
    expect(options.includes('by-ticket')).toBe(enabled);
    expect(options).toContain('tpl-first');
  });

  it('keeps a previously selected by-ticket invoice renderable with the flag off', async () => {
    releaseFlag.enabled = false;
    render(<InvoicePreviewPanel invoiceId="inv-1" selectedTemplateId="by-ticket" onTemplateChange={vi.fn()} isFinalized={false}
      templates={[...defaultTemplates, { template_id: 'by-ticket', name: 'By Ticket', isStandard: true, standard_invoice_template_code: 'standard-invoice-by-ticket' }] as any} />);
    await screen.findByText('INV-1001::by-ticket');
    expect((screen.getByRole('combobox', { name: 'Invoice layout' }) as HTMLSelectElement).value).toBe('by-ticket');
  });

});

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
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

vi.mock('../../../actions/voidInvoiceActions', () => ({ voidInvoice: vi.fn() }));
vi.mock('../../../actions/accountingSyncActions', () => ({
  queueInvoiceSync: vi.fn(), runAccountingSyncNow: vi.fn(),
  resolveAccountingDriftReExport: vi.fn(), resolveAccountingDriftAccept: vi.fn(),
}));
vi.mock('../../invoices/useInvoiceSyncStatuses', () => ({ useInvoiceSyncStatuses: () => ({ statuses: {}, hidden: true }) }));
vi.mock('../../invoices/InvoiceSyncBadge', () => ({ InvoiceSyncBadge: () => null, qboInvoiceDeepLink: vi.fn(), xeroInvoiceDeepLink: vi.fn() }));

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

vi.mock('./InvoiceHistorySection', () => ({ default: () => null }));
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

vi.mock('./DraftInvoiceAdjustmentsCard', () => ({
  default: (props: any) => <button onClick={() => props.onUpdated?.()}>Save draft adjustment</button>,
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

  it('offers sign-in and explicit preview retry after an authentication failure', async () => {
    getEnrichedInvoiceViewModelMock.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' });
    render(<InvoicePreviewPanel invoiceId="inv-1" templates={defaultTemplates as any} selectedTemplateId={null} onTemplateChange={vi.fn()} isFinalized={false} />);

    expect(await screen.findByText(/Your session expired while loading this invoice/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('target')).toBe('_blank');
    getEnrichedInvoiceViewModelMock.mockResolvedValue(defaultViewModel);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(templateRendererMock).toHaveBeenCalled());
    expect(getEnrichedInvoiceViewModelMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the parent DraftsTab summary after an adjustment save', async () => {
    const onDraftInvoiceUpdated = vi.fn(async () => {});
    render(<InvoicePreviewPanel
      invoiceId="inv-1"
      templates={defaultTemplates as any}
      selectedTemplateId={null}
      onTemplateChange={vi.fn()}
      onDraftInvoiceUpdated={onDraftInvoiceUpdated}
      isFinalized={false}
      draftInvoiceSummary={{ invoice_id: 'inv-1', status: 'draft', draft_adjustment_revision: 7 } as any}
    />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft adjustment' }));
    await waitFor(() => expect(onDraftInvoiceUpdated).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getEnrichedInvoiceViewModelMock).toHaveBeenCalledTimes(2));
  });

  it('recovers when the auxiliary source quote read returns an unauthenticated action result', async () => {
    getQuoteByConvertedInvoiceIdMock.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required' });
    render(<InvoicePreviewPanel invoiceId="inv-1" templates={defaultTemplates as any} selectedTemplateId={null} onTemplateChange={vi.fn()} isFinalized={false} />);
    expect(await screen.findByText(/Your session expired while loading this invoice/)).toBeTruthy();
    getQuoteByConvertedInvoiceIdMock.mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(getQuoteByConvertedInvoiceIdMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('INV-1001::tpl-resolved')).toBeTruthy();
    expect(screen.queryByText(/Your session expired while loading this invoice/)).toBeNull();
  });

  it('ignores an invoice preview response after the operator selects a different invoice', async () => {
    let resolvePrevious!: (value: any) => void;
    getEnrichedInvoiceViewModelMock.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    const props = { templates: defaultTemplates as any, selectedTemplateId: null, onTemplateChange: vi.fn(), isFinalized: false };
    const view = render(<InvoicePreviewPanel {...props} invoiceId="inv-old" />);
    await waitFor(() => expect(getEnrichedInvoiceViewModelMock).toHaveBeenCalledTimes(1));
    view.rerender(<InvoicePreviewPanel {...props} invoiceId="inv-new" />);
    await waitFor(() => expect(getEnrichedInvoiceViewModelMock).toHaveBeenCalledTimes(2));
    resolvePrevious({ ...defaultViewModel, invoiceNumber: 'STALE-OLD' });
    expect(await screen.findByText('INV-1001::tpl-resolved')).toBeTruthy();
    expect(screen.queryByText('STALE-OLD::tpl-resolved')).toBeNull();
  });

  it('ignores a late source quote authentication failure after invoice reselection', async () => {
    let rejectPrevious!: (error: unknown) => void;
    getQuoteByConvertedInvoiceIdMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrevious = reject; }));
    const props = { templates: defaultTemplates as any, selectedTemplateId: null, onTemplateChange: vi.fn(), isFinalized: false };
    const view = render(<InvoicePreviewPanel {...props} invoiceId="inv-old" />);
    await waitFor(() => expect(getQuoteByConvertedInvoiceIdMock).toHaveBeenCalledTimes(1));
    view.rerender(<InvoicePreviewPanel {...props} invoiceId="inv-new" />);
    await waitFor(() => expect(getQuoteByConvertedInvoiceIdMock).toHaveBeenCalledTimes(2));
    rejectPrevious({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required' });
    await waitFor(() => expect(screen.getByText('INV-1001::tpl-resolved')).toBeTruthy());
    expect(screen.queryByText(/session expired while loading this invoice/i)).toBeNull();
  });
});

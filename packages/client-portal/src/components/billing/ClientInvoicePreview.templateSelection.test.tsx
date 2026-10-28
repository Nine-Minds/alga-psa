/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientInvoicePreview from './ClientInvoicePreview';

const mocks = vi.hoisted(() => ({
  getClientInvoicePreview: vi.fn(),
}));

const i18n = vi.hoisted(() => ({
  t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoicePreview: mocks.getClientInvoicePreview,
}));

vi.mock('@alga-psa/billing/components', () => ({
  PaperInvoice: ({ children }: any) => <div>{children}</div>,
  TemplateRenderer: ({ template, invoiceData }: any) => (
    <div>
      <div data-testid="rendered-template">{template?.template_id ?? 'NO_TEMPLATE'}</div>
      <div data-testid="rendered-invoice">{invoiceData?.invoiceNumber ?? 'NO_INVOICE'}</div>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div>Loading...</div>,
}));

beforeEach(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  mocks.getClientInvoicePreview.mockReset();
  mocks.getClientInvoicePreview.mockImplementation(async (invoiceId: string) => ({
    invoice: invoice(invoiceId),
    template: template('tpl-standard', true),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function invoice(invoiceId: string, invoiceNumber = `NUM-${invoiceId}`) {
  return {
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    invoice_date: '2026-02-01',
    due_date: '2026-02-15',
    subtotal: 10000,
    tax: 0,
    total: 10000,
    total_amount: 10000,
    currency_code: 'USD',
    client: { name: 'Acme Corp', address: '123 Main' },
    invoice_charges: [],
  };
}

function template(template_id: string, isStandard = false) {
  return {
    template_id,
    template_name: template_id,
    isStandard,
    template_data: {},
  };
}

async function expectRenderedTemplate(templateId: string) {
  await waitFor(() => {
    expect(screen.getByTestId('rendered-template')).toHaveTextContent(templateId);
  });
}

// Template selection (client override / tenant default / fallbacks) now happens
// inside getClientInvoicePreview; see client-billing.invoicePreview.test.ts.
describe('ClientInvoicePreview', () => {
  it('renders the template and invoice returned by getClientInvoicePreview', async () => {
    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-standard');
    expect(screen.getByTestId('rendered-invoice')).toHaveTextContent('NUM-inv-1');
    expect(mocks.getClientInvoicePreview).toHaveBeenCalledWith('inv-1');
  });

  it('shows the unavailable state when the action returns no template', async () => {
    mocks.getClientInvoicePreview.mockResolvedValue({ invoice: invoice('inv-1'), template: null });

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('Unable to display invoice preview.')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('shows the load error when the action rejects', async () => {
    mocks.getClientInvoicePreview.mockRejectedValue(new Error('boom'));

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('Failed to load invoice')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('shows an action error without rendering invoice content', async () => {
    mocks.getClientInvoicePreview.mockResolvedValue({ actionError: 'Invoice not found' });

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('shows a permission error without rendering invoice content', async () => {
    mocks.getClientInvoicePreview.mockResolvedValue({ permissionError: 'No invoice access' });

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('No invoice access')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('reloads when the invoice id changes', async () => {
    mocks.getClientInvoicePreview.mockImplementation(async (invoiceId: string) => ({
      invoice: invoice(invoiceId),
      template: template(invoiceId === 'inv-1' ? 'tpl-a' : 'tpl-b'),
    }));

    const { rerender } = render(<ClientInvoicePreview invoiceId="inv-1" />);
    await expectRenderedTemplate('tpl-a');

    rerender(<ClientInvoicePreview invoiceId="inv-2" />);
    await expectRenderedTemplate('tpl-b');
    expect(screen.getByTestId('rendered-invoice')).toHaveTextContent('NUM-inv-2');
  });
});

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientInvoicePreview from './ClientInvoicePreview';

const mocks = vi.hoisted(() => ({
  getClientInvoiceById: vi.fn(),
  getClientInvoiceTemplates: vi.fn(),
  getResolvedInvoiceTemplateId: vi.fn(),
}));

const i18n = vi.hoisted(() => ({
  t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoiceById: mocks.getClientInvoiceById,
  getClientInvoiceTemplates: mocks.getClientInvoiceTemplates,
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getResolvedInvoiceTemplateId: mocks.getResolvedInvoiceTemplateId,
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

  mocks.getClientInvoiceById.mockReset();
  mocks.getClientInvoiceTemplates.mockReset();
  mocks.getResolvedInvoiceTemplateId.mockReset();

  mocks.getClientInvoiceById.mockImplementation(async (invoiceId: string) => invoice(invoiceId));
  mocks.getClientInvoiceTemplates.mockResolvedValue([]);
  mocks.getResolvedInvoiceTemplateId.mockResolvedValue(null);
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

describe('ClientInvoicePreview template selection', () => {
  it('T001: uses a resolved client override even when a standard template is listed first', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-standard', true),
      template('tpl-custom-a'),
      template('tpl-client-override'),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-client-override');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-client-override');
    expect(mocks.getResolvedInvoiceTemplateId).toHaveBeenCalledWith('inv-1');
  });

  it('T001: uses a resolved tenant-default template', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-standard', true),
      template('tpl-tenant-default'),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-tenant-default');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-tenant-default');
  });

  it('T001: matches a resolved non-first standard template by id', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-standard-first', true),
      template('tpl-standard-second', true),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-standard-second');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-standard-second');
  });

  it('T001: falls back to the first standard template when the resolver returns null', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-custom-a'),
      template('tpl-standard', true),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue(null);

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-standard');
  });

  it('T001: falls back to the first standard template when the resolved id is not available', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-custom-a'),
      template('tpl-standard', true),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-missing');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-standard');
  });

  it('T001: falls back to the first available template when no standard template exists', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-custom-a'),
      template('tpl-custom-b'),
    ]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-missing');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-custom-a');
  });

  it('T001: shows the unavailable state when no templates exist', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue(null);

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(
      await screen.findByText('Unable to display invoice preview.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('T002: shows the load error and no invoice content when the resolver rejects', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([template('tpl-standard', true)]);
    mocks.getResolvedInvoiceTemplateId.mockRejectedValue(new Error('resolver unavailable'));

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('Failed to load invoice')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('T002: shows the invoice action error without rendering invoice content', async () => {
    mocks.getClientInvoiceById.mockResolvedValue({ actionError: 'Invoice not found' });
    mocks.getClientInvoiceTemplates.mockResolvedValue([template('tpl-standard', true)]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-standard');

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('T002: shows the template action error without rendering invoice content', async () => {
    mocks.getClientInvoiceById.mockResolvedValue(invoice('inv-1'));
    mocks.getClientInvoiceTemplates.mockResolvedValue({ permissionError: 'No template access' });
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue(null);

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    expect(await screen.findByText('No template access')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-template')).not.toBeInTheDocument();
  });

  it('T002: re-resolves and selects the second invoice template after a completed load', async () => {
    mocks.getClientInvoiceTemplates.mockResolvedValue([
      template('tpl-standard', true),
      template('tpl-custom-a'),
      template('tpl-custom-b'),
    ]);
    mocks.getClientInvoiceById.mockImplementation(async (invoiceId: string) =>
      invoice(invoiceId, `NUM-${invoiceId}`)
    );
    mocks.getResolvedInvoiceTemplateId.mockImplementation(async (invoiceId: string) =>
      invoiceId === 'inv-1' ? 'tpl-custom-a' : 'tpl-custom-b'
    );

    const { rerender } = render(<ClientInvoicePreview invoiceId="inv-1" />);

    await expectRenderedTemplate('tpl-custom-a');
    expect(screen.getByTestId('rendered-invoice')).toHaveTextContent('NUM-inv-1');

    rerender(<ClientInvoicePreview invoiceId="inv-2" />);

    await expectRenderedTemplate('tpl-custom-b');
    expect(mocks.getResolvedInvoiceTemplateId).toHaveBeenCalledWith('inv-2');
    expect(screen.getByTestId('rendered-invoice')).toHaveTextContent('NUM-inv-2');
  });
});

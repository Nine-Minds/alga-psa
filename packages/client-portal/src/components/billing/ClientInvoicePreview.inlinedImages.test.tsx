/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientInvoicePreview from './ClientInvoicePreview';

const LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

const mocks = vi.hoisted(() => ({ getClientInvoicePreview: vi.fn() }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoicePreview: mocks.getClientInvoicePreview,
}));

vi.mock('@alga-psa/billing/components', () => ({
  PaperInvoice: ({ children }: any) => <div>{children}</div>,
  TemplateRenderer: ({ invoiceData }: any) => (
    <img alt="template logo" src={invoiceData?.tenantClient?.logoUrl ?? ''} />
  ),
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div>Loading...</div>,
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClientInvoicePreview inlined images', () => {
  it('renders an <img> whose src is the inlined data URI from the action', async () => {
    mocks.getClientInvoicePreview.mockResolvedValue({
      invoice: {
        invoice_id: 'inv-1',
        invoice_number: 'INV-1',
        invoice_date: '2026-02-01',
        due_date: '2026-02-15',
        subtotal: 0,
        tax: 0,
        total: 0,
        total_amount: 0,
        currency_code: 'USD',
        client: { name: 'Acme', address: '1 Main' },
        tenantClient: { name: 'MSP', address: null, logoUrl: LOGO_DATA_URI },
        invoice_charges: [],
      },
      template: { template_id: 'tpl-1', template_name: 'Std', isStandard: true },
    });

    render(<ClientInvoicePreview invoiceId="inv-1" />);

    const img = await screen.findByAltText('template logo');
    expect(img).toHaveAttribute('src', LOGO_DATA_URI);
  });
});

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ClientInvoicePreview from './ClientInvoicePreview';

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoiceById: vi.fn(async () => ({
    invoice_id: 'inv-1',
    invoice_number: 'INV-001',
    invoice_date: '2026-02-01',
    due_date: '2026-02-15',
    subtotal: 10000,
    tax: 0,
    total: 10000,
    total_amount: 10000,
    currency_code: 'USD',
    client: {
      name: 'Acme Corp',
      address: '123 Main',
    },
    invoice_charges: [
      {
        item_id: 'charge-1',
        description: 'Managed Firewall',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        service_period_start: '2026-01-01',
        service_period_end: '2026-02-01',
        billing_timing: 'advance',
      },
    ],
  })),
  getClientInvoiceTemplates: vi.fn(async () => [
    {
      template_id: 'tpl-1',
      template_name: 'Standard',
      isStandard: true,
      template_data: {},
    },
  ]),
}));

vi.mock('@alga-psa/billing/components', () => ({
  PaperInvoice: ({ children }: any) => <div>{children}</div>,
  TemplateRenderer: ({ invoiceData }: any) => (
    <div>
      <div>preview-invoice:{invoiceData?.invoiceNumber}</div>
      <div>preview-item:{invoiceData?.items?.[0]?.description}</div>
      <div>preview-period:{invoiceData?.items?.[0]?.servicePeriodStart}:{invoiceData?.items?.[0]?.servicePeriodEnd}</div>
      <div>preview-timing:{invoiceData?.items?.[0]?.billingTiming}</div>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div>Loading...</div>,
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ClientInvoicePreview recurring service periods', () => {
  it('T088: client invoice preview keeps canonical recurring service periods in the renderer view model', async () => {
    render(<ClientInvoicePreview invoiceId="inv-1" />);

    await waitFor(() => {
      expect(screen.getByText('preview-invoice:INV-001')).toBeInTheDocument();
    });

    expect(screen.getByText('preview-item:Managed Firewall')).toBeInTheDocument();
    expect(screen.getByText('preview-period:2026-01-01:2026-02-01')).toBeInTheDocument();
    expect(screen.getByText('preview-timing:advance')).toBeInTheDocument();
  });
});

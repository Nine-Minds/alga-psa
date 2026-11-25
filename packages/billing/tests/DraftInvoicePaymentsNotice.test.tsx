// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

// T006 (alga-2026-0003329)
const mocks = vi.hoisted(() => ({ getInvoicePaymentSummary: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoicePaymentActions', () => ({
  getInvoicePaymentSummary: mocks.getInvoicePaymentSummary,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, opts: { defaultValue: string; [k: string]: unknown }) =>
      opts.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts[name])),
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: any) => <div id={id}>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

import DraftInvoicePaymentsNotice from '../src/components/billing-dashboard/invoicing/DraftInvoicePaymentsNotice';

const summary = (over: Record<string, unknown>) => ({
  invoiceId: 'inv-1', invoiceNumber: 'INV-1', status: 'draft', currencyCode: 'EUR',
  totalAmount: 10000, creditApplied: 0, totalPaid: 0, balanceDue: 10000,
  canRecordPayment: false, blockedReason: 'draft', ...over,
});

describe('DraftInvoicePaymentsNotice', () => {
  beforeEach(() => mocks.getInvoicePaymentSummary.mockReset());
  afterEach(cleanup);

  it('shows nothing when no payments are recorded', async () => {
    mocks.getInvoicePaymentSummary.mockResolvedValue(summary({}));
    const { container } = render(<DraftInvoicePaymentsNotice invoiceId="inv-1" />);
    await waitFor(() => expect(mocks.getInvoicePaymentSummary).toHaveBeenCalledWith('inv-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the net amount paid in the invoice currency, without a warning', async () => {
    mocks.getInvoicePaymentSummary.mockResolvedValue(summary({ totalPaid: 4000 }));
    render(<DraftInvoicePaymentsNotice invoiceId="inv-1" />);
    const note = await screen.findByText(/are recorded against this invoice/);
    expect(note.textContent).toContain('€40.00');
    expect(screen.queryByText(/overpaid/)).toBeNull();
  });

  it('warns when the draft total is below the amount paid', async () => {
    mocks.getInvoicePaymentSummary.mockResolvedValue(summary({ totalAmount: 6000, totalPaid: 10000 }));
    render(<DraftInvoicePaymentsNotice invoiceId="inv-1" />);
    expect(await screen.findByText(/Finalizing will leave this invoice overpaid/)).toBeInTheDocument();
    expect(screen.getByText(/are recorded against this invoice/).textContent).toContain('€100.00');
  });

  it('renders nothing when the summary is unavailable', async () => {
    mocks.getInvoicePaymentSummary.mockResolvedValue({ actionError: 'nope' });
    const { container } = render(<DraftInvoicePaymentsNotice invoiceId="inv-1" />);
    await waitFor(() => expect(mocks.getInvoicePaymentSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

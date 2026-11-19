// @vitest-environment jsdom

/**
 * The invoice Payments dialog (alga-2026-0003364): the only place a recorded
 * payment can be taken back.
 *
 * What these tests hold: reversing always costs a reason; a payment that came
 * from the accounting system is NOT offered as a plain reversal — it names the
 * QuickBooks payment to fix there, and only a holder of the accounting
 * remote-mutate capability is offered the explicit "in AlgaPSA only" unlink;
 * Stripe money points at the refund flow instead.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  listInvoicePayments: vi.fn(),
  reverseInvoicePayment: vi.fn(),
  translate: vi.fn(),
  capabilities: { remoteMutate: false },
}));

vi.mock('@alga-psa/billing/actions/invoicePaymentActions', () => ({
  listInvoicePayments: mocks.listInvoicePayments,
  reverseInvoicePayment: mocks.reverseInvoicePayment,
}));
vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => mocks.capabilities,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({ t: mocks.translate }),
  useFormatters: () => ({ locale: 'en-US', formatDate: () => '2 Nov 2026', formatCurrency: (v: number) => `$${v}` }),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer, title }: any) => (
    isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null
  ),
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: any) => <div id={id}>{children}</div>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, ...props }: any) => <textarea aria-label={label} {...props} />,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange, disabled }: any) => (
    <label htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  ),
}));

import { InvoicePaymentsDialog } from '../src/components/billing-dashboard/invoicing/InvoicePaymentsDialog';

const manualPayment = (overrides: Record<string, unknown> = {}) => ({
  paymentId: 'pay-1',
  invoiceId: 'inv-1',
  amount: 10000,
  method: 'check',
  referenceNumber: '1042',
  paymentDate: '2026-11-02',
  notes: null,
  status: 'completed',
  source: 'manual',
  externalReference: null,
  reversed: false,
  canReverse: true,
  blockedReason: null,
  requiresAlgaOnly: false,
  ...overrides,
});

const quickbooksPayment = (overrides: Record<string, unknown> = {}) => manualPayment({
  paymentId: 'pay-qbo',
  method: 'quickbooks',
  source: 'quickbooks',
  externalReference: '3547',
  requiresAlgaOnly: true,
  ...overrides,
});

function open(props: Record<string, unknown> = {}) {
  return render(
    <InvoicePaymentsDialog
      isOpen
      onClose={vi.fn()}
      invoiceId="inv-1"
      invoiceNumber="INV-003256"
      {...props}
    />,
  );
}

describe('InvoicePaymentsDialog', () => {
  beforeEach(() => {
    mocks.translate.mockImplementation((key: string, options?: Record<string, any>) => {
      const template = options?.defaultValue ?? key;
      return String(template).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
    });
    mocks.capabilities = { remoteMutate: false };
    mocks.listInvoicePayments.mockResolvedValue([manualPayment()]);
    mocks.reverseInvoicePayment.mockResolvedValue({
      success: true, reversalPaymentId: 'rev-1', invoiceId: 'inv-1', newStatus: 'sent', balanceDue: 10000, unlinked: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists a recorded payment with its source', async () => {
    open();

    expect(await screen.findByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('Recorded in AlgaPSA')).toBeInTheDocument();
    expect(screen.getByText(/1042/)).toBeInTheDocument();
  });

  it('says so when nothing has been recorded', async () => {
    mocks.listInvoicePayments.mockResolvedValue([]);
    open();

    expect(await screen.findByText(/No payments have been recorded/)).toBeInTheDocument();
  });

  it('reverses a manual payment only once a reason is given', async () => {
    const onChanged = vi.fn();
    open({ onChanged });

    fireEvent.click(await screen.findByText('Reverse payment'));

    const confirm = screen.getByRole('button', { name: 'Reverse payment' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Keyed twice' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.reverseInvoicePayment).toHaveBeenCalledWith({
      paymentId: 'pay-1',
      reason: 'Keyed twice',
      algaOnly: undefined,
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a refusal from the action', async () => {
    mocks.reverseInvoicePayment.mockResolvedValue({ actionError: 'This payment has already been reversed.' });
    open();

    fireEvent.click(await screen.findByText('Reverse payment'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Keyed twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse payment' }));

    expect(await screen.findByText('This payment has already been reversed.')).toBeInTheDocument();
  });

  it('points a Stripe payment at the refund flow instead of offering a reversal', async () => {
    mocks.listInvoicePayments.mockResolvedValue([
      manualPayment({ source: 'stripe', method: 'stripe', canReverse: false, blockedReason: 'stripe_refund_required' }),
    ]);
    open();

    expect(await screen.findByText(/refund it in the payment provider/)).toBeInTheDocument();
    expect(screen.queryByText('Reverse payment')).not.toBeInTheDocument();
  });

  it('marks an already-reversed payment as spent', async () => {
    mocks.listInvoicePayments.mockResolvedValue([
      manualPayment({ reversed: true, canReverse: false, blockedReason: 'already_reversed' }),
    ]);
    open();

    expect(await screen.findByText('Already reversed.')).toBeInTheDocument();
    expect(screen.queryByText('Reverse payment')).not.toBeInTheDocument();
  });

  // Without the capability the operator gets the instruction, not a button:
  // the payment belongs to QuickBooks and the sync is the way back.
  it('sends an integration-owned payment to QuickBooks for a user without remote-mutate', async () => {
    mocks.listInvoicePayments.mockResolvedValue([quickbooksPayment()]);
    open();

    expect(await screen.findByText(/came from QuickBooks payment 3547/)).toBeInTheDocument();
    expect(screen.queryByText('Reverse payment')).not.toBeInTheDocument();
  });

  it('offers the AlgaPSA-only unlink, with its warning, to a remote-mutate holder', async () => {
    mocks.capabilities = { remoteMutate: true };
    mocks.listInvoicePayments.mockResolvedValue([quickbooksPayment()]);
    mocks.reverseInvoicePayment.mockResolvedValue({
      success: true, reversalPaymentId: 'rev-1', invoiceId: 'inv-1', newStatus: 'sent', balanceDue: 10000, unlinked: true,
    });
    open();

    fireEvent.click(await screen.findByText('Reverse payment'));

    expect(screen.getByText(/came from QuickBooks payment 3547/)).toBeInTheDocument();
    expect(screen.getByText(/AlgaPSA and QuickBooks will disagree/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Reverse payment' });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wizard linked the wrong invoice' } });
    // The unlink has to be chosen deliberately, not inherited from the reason.
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Reverse in AlgaPSA only'));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.reverseInvoicePayment).toHaveBeenCalledWith({
      paymentId: 'pay-qbo',
      reason: 'Wizard linked the wrong invoice',
      algaOnly: true,
    }));
  });

  it('gives every interactive element a kebab-case id', async () => {
    mocks.capabilities = { remoteMutate: true };
    mocks.listInvoicePayments.mockResolvedValue([quickbooksPayment()]);
    const { container } = open();

    fireEvent.click(await screen.findByText('Reverse payment'));

    for (const id of [
      'invoice-payments-list',
      'invoice-payments-row-pay-qbo',
      'invoice-payments-reason-pay-qbo',
      'invoice-payments-alga-only-pay-qbo',
      'invoice-payments-confirm-reverse-pay-qbo',
      'invoice-payments-cancel-reverse-pay-qbo',
      'invoice-payments-close',
    ]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });
});

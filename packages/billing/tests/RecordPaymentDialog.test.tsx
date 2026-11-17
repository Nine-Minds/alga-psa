// @vitest-environment jsdom

/**
 * The manual Record Payment dialog (alga-2026-0003329 / alga-2026-0003183):
 * the amount must default to the balance due, a partial amount must be
 * allowed, and the submit must hand the action minor units.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  getInvoicePaymentSummary: vi.fn(),
  recordManualInvoicePayment: vi.fn(),
  translate: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoicePaymentActions', () => ({
  getInvoicePaymentSummary: mocks.getInvoicePaymentSummary,
  recordManualInvoicePayment: mocks.recordManualInvoicePayment,
  MANUAL_PAYMENT_METHODS: ['manual', 'check', 'bank_transfer', 'cash', 'other'],
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({ t: mocks.translate }),
  useFormatters: () => ({ locale: 'en-US', formatDate: () => 'today', formatCurrency: (v: number) => `$${v}` }),
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
  Alert: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, ...props }: any) => <input aria-label={label} {...props} />,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, ...props }: any) => <textarea aria-label={label} {...props} />,
}));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ id, label, value, onChange, disabled }: any) => (
    <input
      id={id}
      aria-label={label}
      disabled={disabled}
      value={value ?? ''}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  ),
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, label }: any) => <input id={id} aria-label={label} readOnly />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled }: any) => (
    <select id={id} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { RecordPaymentDialog } from '../src/components/billing-dashboard/invoicing/RecordPaymentDialog';

const summary = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: 'inv-1',
  invoiceNumber: 'INV-000008',
  status: 'sent',
  currencyCode: 'USD',
  totalAmount: 10000,
  creditApplied: 0,
  totalPaid: 0,
  balanceDue: 10000,
  canRecordPayment: true,
  ...overrides,
});

describe('RecordPaymentDialog', () => {
  beforeEach(() => {
    mocks.translate.mockImplementation((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key);
    mocks.getInvoicePaymentSummary.mockResolvedValue(summary());
    mocks.recordManualInvoicePayment.mockResolvedValue({ success: true, paymentId: 'pay-1', newStatus: 'paid', balanceDue: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults the amount to the balance due and submits it in minor units', async () => {
    render(<RecordPaymentDialog isOpen onClose={vi.fn()} invoiceId="inv-1" invoiceNumber="INV-000008" />);

    const amount = await screen.findByLabelText('Amount');
    await waitFor(() => expect(amount).toHaveValue('100'));

    fireEvent.click(screen.getByText('Record Payment'));

    await waitFor(() => expect(mocks.recordManualInvoicePayment).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', amount: 10000, method: 'manual' }),
    ));
  });

  it('allows a partial amount and passes the chosen method and reference', async () => {
    const onClose = vi.fn();
    render(<RecordPaymentDialog isOpen onClose={onClose} invoiceId="inv-1" />);

    const amount = await screen.findByLabelText('Amount');
    fireEvent.change(amount, { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Payment method') ?? screen.getByRole('combobox'), { target: { value: 'check' } });
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: '1042' } });

    fireEvent.click(screen.getByText('Record Payment'));

    await waitFor(() => expect(mocks.recordManualInvoicePayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4000, method: 'check', referenceNumber: '1042' }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('surfaces an action refusal and keeps the dialog open', async () => {
    mocks.recordManualInvoicePayment.mockResolvedValue({
      actionError: 'Cannot record a payment for an invoice with status: cancelled.',
      messageKey: 'msp/invoicing:errors.recordPayment.statusNotPayable',
    });
    const onClose = vi.fn();
    render(<RecordPaymentDialog isOpen onClose={onClose} invoiceId="inv-1" />);

    await screen.findByLabelText('Amount');
    fireEvent.click(screen.getByText('Record Payment'));

    expect(await screen.findByText('Cannot record a payment for an invoice with status: cancelled.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables submit for an invoice with nothing left to pay', async () => {
    mocks.getInvoicePaymentSummary.mockResolvedValue(summary({ status: 'paid', balanceDue: 0, totalPaid: 10000, canRecordPayment: false }));
    render(<RecordPaymentDialog isOpen onClose={vi.fn()} invoiceId="inv-1" />);

    await screen.findByLabelText('Amount');
    expect(screen.getByText('Record Payment').closest('button')).toBeDisabled();
  });
});

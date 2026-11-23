// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recipients: vi.fn(),
  senders: vi.fn(),
  send: vi.fn(),
  schedule: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(() => 'toast-1'),
}));

vi.mock('@alga-psa/email/senderActions', () => ({ listSelectableSenders: mocks.senders }));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({
  getInvoiceEmailRecipientAction: mocks.recipients,
  scheduleInvoiceEmailAction: mocks.schedule,
  sendInvoiceEmailAction: mocks.send,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => isOpen ? <section><h1>{title}</h1>{children}{footer}</section> : null,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, ...props }: any) => <button id={id} {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-hot-toast', () => ({ default: { loading: mocks.toastLoading, success: vi.fn(), error: mocks.toastError, dismiss: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (value: any) => value?.permissionError || value?.actionError || 'error', handleError: vi.fn(), isActionMessageError: (value: any) => Boolean(value?.actionError), isActionPermissionError: (value: any) => Boolean(value?.permissionError),
}));

import { SendInvoiceEmailDialog } from '../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog';

describe('SendInvoiceEmailDialog sender selection', () => {
  beforeEach(() => {
    mocks.recipients.mockResolvedValue({ recipients: [{ invoiceId: 'invoice-1', invoiceNumber: 'INV-1', clientName: 'Example', recipientEmail: 'billing@example.test', recipientName: 'Billing', recipientSource: 'billing_contact', totalAmount: '10.00', currencyCode: 'USD', dueDate: null, invoiceDate: null, companyName: 'Example', fromEmail: 'default@example.test' }], errors: [] });
    mocks.senders.mockResolvedValue({ senders: [{ sender_id: 'billing', email_address: 'billing@example.test', display_name: 'Billing' }, { sender_id: 'accounts', email_address: 'accounts@example.test', display_name: 'Accounts' }], effectiveSenderId: 'billing', effectiveSenderAddress: 'billing@example.test' });
    mocks.send.mockResolvedValue({ successCount: 1, failureCount: 0 });
    mocks.schedule.mockResolvedValue({ jobId: 'scheduled-job-1' });
  });

  it('renders a sender selector when multiple billing senders are selectable', async () => {
    render(<SendInvoiceEmailDialog isOpen onClose={vi.fn()} invoiceIds={['invoice-1']} />);
    await waitFor(() => expect(screen.getByLabelText('sendEmail.fields.from')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'accounts@example.test' })).toBeTruthy();
  });

  it('selects provider From by sentinel and sends without pinning the first saved sender when no route exists', async () => {
    mocks.senders.mockResolvedValue({
      senders: [
        { sender_id: 'first', email_address: 'first@example.test', display_name: null },
        { sender_id: 'second', email_address: 'second@example.test', display_name: null },
      ],
      effectiveSenderId: null,
      effectiveSenderAddress: 'provider-from@example.test',
    });
    render(<SendInvoiceEmailDialog isOpen onClose={vi.fn()} invoiceIds={['invoice-1']} />);

    const select = await screen.findByLabelText('sendEmail.fields.from') as HTMLSelectElement;
    expect(select.value).toBe('__default__');
    expect(screen.getByRole('option', { name: 'sendEmail.fields.useDefault (provider-from@example.test)' })).toBeTruthy();

    fireEvent.click(document.getElementById('send-invoice-email-send')!);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(['invoice-1'], undefined, undefined));
  });

  it('schedules the resolved invoice through the imported server action and reports authorization denial', async () => {
    mocks.schedule.mockResolvedValueOnce({ permissionError: 'Permission denied: invoice send required' });
    render(<SendInvoiceEmailDialog isOpen onClose={vi.fn()} invoiceIds={['invoice-1']} />);

    await screen.findByLabelText('sendEmail.fields.from');
    fireEvent.click(document.getElementById('schedule-invoice-email')!);

    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledWith(['invoice-1'], undefined));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Permission denied: invoice send required', { id: expect.anything() }));
  });

  it('closes the dialog after the scheduler returns a job ID', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<SendInvoiceEmailDialog isOpen onClose={onClose} onSuccess={onSuccess} invoiceIds={['invoice-1']} />);

    await screen.findByLabelText('sendEmail.fields.from');
    fireEvent.click(document.getElementById('schedule-invoice-email')!);

    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledWith(['invoice-1'], undefined));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

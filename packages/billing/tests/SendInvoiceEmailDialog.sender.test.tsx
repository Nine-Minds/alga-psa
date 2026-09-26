// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recipients: vi.fn(),
  senders: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({ listSelectableSenders: mocks.senders }));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({
  getInvoiceEmailRecipientAction: mocks.recipients,
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
vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'error', handleError: vi.fn(), isActionMessageError: () => false, isActionPermissionError: () => false,
}));

import { SendInvoiceEmailDialog } from '../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog';

describe('SendInvoiceEmailDialog sender selection', () => {
  beforeEach(() => {
    mocks.recipients.mockResolvedValue({ recipients: [{ invoiceId: 'invoice-1', invoiceNumber: 'INV-1', clientName: 'Example', recipientEmail: 'billing@example.test', recipientName: 'Billing', recipientSource: 'billing_contact', totalAmount: '10.00', currencyCode: 'USD', dueDate: null, invoiceDate: null, companyName: 'Example', fromEmail: 'default@example.test' }], errors: [] });
    mocks.senders.mockResolvedValue({ senders: [{ sender_id: 'billing', email_address: 'billing@example.test', display_name: 'Billing' }, { sender_id: 'accounts', email_address: 'accounts@example.test', display_name: 'Accounts' }], effectiveSenderId: 'billing' });
    mocks.send.mockResolvedValue({ successCount: 1, failureCount: 0 });
  });

  it('renders a sender selector when multiple billing senders are selectable', async () => {
    render(<SendInvoiceEmailDialog isOpen onClose={vi.fn()} invoiceIds={['invoice-1']} />);
    await waitFor(() => expect(screen.getByLabelText('sendEmail.fields.from')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'accounts@example.test' })).toBeTruthy();
  });
});

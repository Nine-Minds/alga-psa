// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), verify: vi.fn(), clearRoute: vi.fn() }));
vi.mock('../../../actions/email-actions/emailSenderActions', () => ({
  listEmailSenders: actionMocks.list,
  createEmailSender: actionMocks.create,
  updateEmailSender: actionMocks.update,
  deleteEmailSender: actionMocks.remove,
  verifyEmailSender: actionMocks.verify,
  setEmailSenderRoute: vi.fn(),
  clearEmailSenderRoute: actionMocks.clearRoute,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children, footer }: any) => isOpen ? <section id={id}><h2>{title}</h2>{children}{footer}</section> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

import { EmailSenderAddressesCard, EmailSenderRoutingCard } from './EmailSenderRoutingCards';

const t = (key: string) => key;

describe('outbound email sender cards', () => {
  it('adapts the Add dialog to managed domains and SMTP relay requirements', async () => {
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    const { rerender } = render(<EmailSenderAddressesCard t={t} transport="resend" verifiedDomains={['example.test']} />);
    fireEvent.click(screen.getAllByText('email.senderIdentities.actions.add')[0]);
    expect(screen.getByLabelText('email.senderIdentities.fields.localPart')).toBeInTheDocument();
    expect(screen.getByLabelText('email.senderIdentities.fields.domain')).toBeInTheDocument();

    fireEvent.click(screen.getByText('common.actions.cancel'));
    rerender(<EmailSenderAddressesCard t={t} transport="smtp" />);
    await waitFor(() => expect(screen.getByText('email.senderIdentities.addresses.title')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('email.senderIdentities.actions.add')[0]);
    expect(screen.getByLabelText('email.senderIdentities.fields.address')).toBeInTheDocument();
    expect(screen.getByText('email.senderIdentities.smtpHelp')).toBeInTheDocument();
  });

  it('shows add sender failures inside the dialog and offers a clear default route', async () => {
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    actionMocks.create.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    const { container } = render(<EmailSenderAddressesCard t={t} transport="smtp" />);
    fireEvent.click(screen.getAllByText('email.senderIdentities.actions.add')[0]);
    fireEvent.change(screen.getByLabelText('email.senderIdentities.fields.address'), { target: { value: 'duplicate@example.test' } });
    fireEvent.click(document.getElementById('email-sender-add')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('email.senderIdentities.errors.duplicateAddress'));
    expect(container.querySelector('#email-sender-add-dialog')?.contains(screen.getByRole('alert'))).toBe(true);

    actionMocks.create.mockReset();
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    const routeContainer = render(<EmailSenderRoutingCard t={t} />);
    await waitFor(() => expect(screen.getByText('email.senderIdentities.routes.default')).toBeInTheDocument());
    expect(routeContainer.container.textContent).toContain('email.senderIdentities.routes.noneProviderFrom');
    fireEvent.click(routeContainer.container.querySelector('#email-sender-route-default-save')!);
    await waitFor(() => expect(actionMocks.clearRoute).toHaveBeenCalledWith(expect.objectContaining({ routeType: 'default' })));
  });

  it('shows ticket inbound-reply guidance and a read-only board override summary', async () => {
    actionMocks.list.mockResolvedValue({
      senders: [{ sender_id: 'support', email_address: 'support@example.test', display_name: null, verification_status: 'verified' }],
      routes: [
        { route_id: 'board-route', route_type: 'board', mail_class: null, board_id: 'board-1', sender_id: 'support', display_name: null },
        { route_id: 'ticket-route', route_type: 'mail_class', mail_class: 'ticket', board_id: null, sender_id: 'support', display_name: null },
      ],
    });
    render(<EmailSenderRoutingCard t={t} />);
    await waitFor(() => expect(screen.getByText(/board-1: support@example.test/)).toBeInTheDocument());
    expect(screen.getAllByText('email.senderIdentities.routes.inboundReplyWarning').length).toBeGreaterThan(0);
  });
});

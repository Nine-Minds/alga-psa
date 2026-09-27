// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), verify: vi.fn(), clearRoute: vi.fn(), setRoute: vi.fn() }));
vi.mock('../../../actions/email-actions/emailSenderActions', () => ({
  listEmailSenders: actionMocks.list,
  createEmailSender: actionMocks.create,
  updateEmailSender: actionMocks.update,
  deleteEmailSender: actionMocks.remove,
  verifyEmailSender: actionMocks.verify,
  setEmailSenderRoute: actionMocks.setRoute,
  clearEmailSenderRoute: actionMocks.clearRoute,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children, footer }: any) => isOpen ? <section id={id}><h2>{title}</h2>{children}{footer}</section> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

import { EmailSenderAddressesCard, EmailSenderCardsProvider, EmailSenderRoutingCard } from './EmailSenderRoutingCards';
const enAdmin = { common: { actions: { cancel: 'Cancel' } }, email: { senderIdentities: { routing: { default: 'Default (all other mail)' } } } };

const renderCards = (addresses: React.ReactNode, routing: React.ReactNode) => render(
  <EmailSenderCardsProvider><>{addresses}{routing}</></EmailSenderCardsProvider>,
);

describe('outbound email sender cards', () => {
  it('shows the initial sender load error in both cards', async () => {
    actionMocks.list.mockRejectedValue(new Error('Sender settings unavailable'));
    renderCards(<EmailSenderAddressesCard transport="smtp" />, <EmailSenderRoutingCard />);
    await waitFor(() => expect(screen.getAllByRole('alert').filter(alert => alert.textContent === 'Sender settings unavailable')).toHaveLength(2));
  });

  it('adapts the Add dialog to managed domains and SMTP relay requirements', async () => {
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    const { rerender } = renderCards(<EmailSenderAddressesCard transport="resend" verifiedDomains={['example.test']} />, null);
    fireEvent.click(screen.getAllByText('Add sender')[0]);
    expect(screen.getByLabelText('Address name')).toBeInTheDocument();
    expect(screen.getByLabelText('Verified domain')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    rerender(<EmailSenderCardsProvider><EmailSenderAddressesCard transport="smtp" /></EmailSenderCardsProvider>);
    await waitFor(() => expect(screen.getByText('Sender addresses')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Add sender')[0]);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Your SMTP relay must allow this address.')).toBeInTheDocument();
  });

  it('shows add sender failures inside the dialog and offers a clear default route', async () => {
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    actionMocks.create.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    const { container } = renderCards(<EmailSenderAddressesCard transport="smtp" />, null);
    fireEvent.click(container.querySelector('#email-sender-add-open')!);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'duplicate@example.test' } });
    const addDialog = container.querySelector<HTMLElement>('#email-sender-add-dialog');
    expect(addDialog).toBeInTheDocument();
    fireEvent.click(within(addDialog!).getByRole('button', { name: 'Add sender' }));
    await waitFor(() => expect(within(addDialog!).getByRole('alert')).toHaveTextContent('This sender address already exists.'));
    expect(addDialog).toContainElement(within(addDialog!).getByRole('alert'));

    actionMocks.create.mockReset();
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    const routeContainer = renderCards(null, <EmailSenderRoutingCard />);
    await waitFor(() => expect(screen.getByText('Default (all other mail)')).toBeInTheDocument());
    expect(routeContainer.container.textContent).toContain('None (use provider From)');
    fireEvent.click(routeContainer.container.querySelector('#email-sender-route-default-save')!);
    await waitFor(() => expect(actionMocks.clearRoute).toHaveBeenCalledWith(expect.objectContaining({ routeType: 'default' })));

    fireEvent.change(routeContainer.container.querySelector('#email-sender-route-default-display-name')!, { target: { value: 'Billing team' } });
    fireEvent.click(routeContainer.container.querySelector('#email-sender-route-default-save')!);
    await waitFor(() => expect(actionMocks.setRoute).toHaveBeenCalledWith(expect.objectContaining({
      routeType: 'default', senderId: null, displayName: 'Billing team',
    })));
  });

  it('renders the Default row with its English locale label', async () => {
    actionMocks.list.mockResolvedValue({ senders: [], routes: [] });
    renderCards(null, <EmailSenderRoutingCard />);
    await waitFor(() => expect(screen.getByText('Default (all other mail)')).toBeInTheDocument());
    expect(enAdmin.email.senderIdentities.routing.default).toBe('Default (all other mail)');
  });

  it('shows ticket inbound-reply guidance and a read-only board override summary', async () => {
    actionMocks.list.mockResolvedValue({
      senders: [{ sender_id: 'support', email_address: 'support@example.test', display_name: null, verification_status: 'verified' }],
      routes: [
        { route_id: 'board-route', route_type: 'board', mail_class: null, board_id: 'board-1', board_name: 'Service Desk', sender_id: 'support', display_name: null },
        { route_id: 'ticket-route', route_type: 'mail_class', mail_class: 'ticket', board_id: null, sender_id: 'support', display_name: null },
      ],
    });
    renderCards(null, <EmailSenderRoutingCard />);
    await waitFor(() => expect(screen.getByText(/Service Desk: support@example.test/)).toBeInTheDocument());
    expect(screen.queryByText(/board-1:/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Inbound replies still go to the configured inbound mailbox; changing this From address does not change reply routing.').length).toBeGreaterThan(0);
  });

  it('shows a newly added sender in routing without remounting', async () => {
    const sender = { sender_id: 'new-sender', email_address: 'new@example.test', display_name: null, verification_status: 'verified' };
    actionMocks.list.mockResolvedValueOnce({ senders: [], routes: [] }).mockResolvedValue({ senders: [sender], routes: [] });
    actionMocks.create.mockResolvedValue(sender);
    const { container } = renderCards(<EmailSenderAddressesCard transport="smtp" />, <EmailSenderRoutingCard />);
    await waitFor(() => expect(actionMocks.list).toHaveBeenCalled());
    fireEvent.click(container.querySelector('#email-sender-add-open')!);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: sender.email_address } });
    fireEvent.click(container.querySelector('#email-sender-add')!);
    await waitFor(() => expect(screen.getAllByRole('option', { name: sender.email_address }).length).toBeGreaterThan(0));
  });
});

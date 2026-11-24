/**
 * @vitest-environment jsdom
 *
 * The confirmation step has to be honest before anything is sent: the count on
 * the button is the number of emails that go out, the skips say why, and the
 * visibility note tells the MSP what access the invitations actually grant.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BulkPortalInvitationDialog from './BulkPortalInvitationDialog';

const hoisted = vi.hoisted(() => ({
  getContactsEligibleForInvitation: vi.fn(),
  getPortalInvitationStatesForClient: vi.fn(),
  sendBulkPortalInvitations: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
    let text = String(
      (typeof options?.count === 'number' && options.count === 1
        ? options?.defaultValue_one
        : options?.defaultValue_other)
      ?? options?.defaultValue
      ?? key,
    );
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/clients/actions', () => ({
  getContactsEligibleForInvitation: hoisted.getContactsEligibleForInvitation,
  getPortalInvitationStatesForClient: hoisted.getPortalInvitationStatesForClient,
  sendBulkPortalInvitations: hoisted.sendBulkPortalInvitations,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, title }: any) => <div><h2>{title}</h2>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

const eligible = (id: string, email: string | null, extra: Record<string, unknown> = {}): any => ({
  contact_name_id: id,
  full_name: id,
  email,
  client_id: 'acme',
  phone_numbers: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getContactsEligibleForInvitation.mockResolvedValue([
    eligible('fine', 'fine@acme.com', { portal_visibility_group_id: 'group-1' }),
    eligible('no-email', null),
    eligible('shared', 'shared@acme.com', { contact_kind: 'shared_mailbox' }),
  ]);
  hoisted.getPortalInvitationStatesForClient.mockResolvedValue([]);
});

describe('BulkPortalInvitationDialog', () => {
  it('counts the invitable, names the skip reasons and accounts for every chosen contact', async () => {
    hoisted.sendBulkPortalInvitations.mockResolvedValue({
      success: true, total: 4, sent: 1, skipped: 3, failed: 0,
      results: [
        { contactId: 'fine', email: 'fine@acme.com', status: 'sent' },
        { contactId: 'no-email', status: 'skipped', message: 'Contact does not have an email address.' },
        { contactId: 'shared', status: 'skipped', message: 'Shared mailbox contacts cannot be invited.' },
        { contactId: 'already-a-user', status: 'skipped', message: 'A user account already exists for this contact.' },
      ],
    });

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'selected', contactIds: ['fine', 'no-email', 'shared', 'already-a-user'] }}
        statusFilter="active"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    await screen.findByText('1 contacts will be invited to the client portal.');
    expect(screen.getByText('3 will be skipped:')).toBeInTheDocument();
    expect(screen.getByText('1 — already has portal access')).toBeInTheDocument();
    expect(screen.getByText('1 — no usable email address')).toBeInTheDocument();
    expect(screen.getByText('1 — shared mailbox')).toBeInTheDocument();
    expect(
      screen.getByText(/1 are scoped to a portal visibility group, 0 get full access/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Send 1 invitations'));

    // The whole selection is sent, so the results screen reports the same three
    // skips the preview promised instead of contradicting it with "skipped 0".
    await waitFor(() => expect(hoisted.sendBulkPortalInvitations).toHaveBeenCalledWith({
      clientId: 'acme',
      contactIds: ['fine', 'no-email', 'shared', 'already-a-user'],
    }));
    expect(await screen.findByText('Sent 1, skipped 3, failed 0.')).toBeInTheDocument();
  });

  it('previews a ticked inactive contact against the list\'s own status filter', async () => {
    hoisted.getContactsEligibleForInvitation.mockResolvedValue([
      eligible('dormant', 'dormant@acme.com', { is_inactive: true }),
    ]);

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'selected', contactIds: ['dormant'] }}
        statusFilter="all"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    await screen.findByText('1 contacts will be invited to the client portal.');
    expect(hoisted.getContactsEligibleForInvitation).toHaveBeenCalledWith('acme', 'all');
    expect(screen.queryByText('1 — already has portal access')).not.toBeInTheDocument();
  });

  it('asks the server for every eligible contact when invited in bulk', async () => {
    hoisted.sendBulkPortalInvitations.mockResolvedValue({
      success: true, total: 3, sent: 1, skipped: 2, failed: 0,
      results: [
        { contactId: 'fine', email: 'fine@acme.com', status: 'sent' },
        { contactId: 'no-email', status: 'skipped', message: 'Contact does not have an email address.' },
        { contactId: 'shared', status: 'skipped', message: 'Shared mailbox contacts cannot be invited.' },
      ],
    });

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'allEligible' }}
        statusFilter="all"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText('Send 1 invitations'));

    // "All eligible" is the server's set — active contacts only — whatever the
    // list happens to be filtered to.
    expect(hoisted.getContactsEligibleForInvitation).toHaveBeenCalledWith('acme', 'active');
    await waitFor(() => expect(hoisted.sendBulkPortalInvitations).toHaveBeenCalledWith({
      clientId: 'acme',
      allEligible: true,
    }));
    expect(await screen.findByText('Sent 1, skipped 2, failed 0.')).toBeInTheDocument();
  });

  it('counts a resend from the invitation state, and names the set on the button', async () => {
    hoisted.getContactsEligibleForInvitation.mockResolvedValue([
      eligible('lapsed', 'lapsed@acme.com'),
      eligible('waiting', 'waiting@acme.com'),
      eligible('never', 'never@acme.com'),
    ]);
    hoisted.getPortalInvitationStatesForClient.mockResolvedValue([
      { contactId: 'lapsed', state: 'expired', expiresAt: null },
      { contactId: 'waiting', state: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' },
      { contactId: 'never', state: 'none', expiresAt: null },
    ]);
    hoisted.sendBulkPortalInvitations.mockResolvedValue({
      success: true, total: 1, sent: 1, skipped: 0, failed: 0,
      results: [{ contactId: 'lapsed', email: 'lapsed@acme.com', status: 'sent' }],
    });

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'invitationState', states: ['expired'] }}
        statusFilter="all"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    // Only the expired contact: the eligible rule and the state rule agree, so
    // the count on the button is the number of emails that go out — and a set of
    // one reads as one, not "1 expired invitations".
    await screen.findByText(
      '1 contact will get their invitation again, with the full validity period.',
    );
    fireEvent.click(screen.getByText('Resend 1 expired invitation'));

    await waitFor(() => expect(hoisted.sendBulkPortalInvitations).toHaveBeenCalledWith({
      clientId: 'acme',
      invitationStates: ['expired'],
    }));
    expect(await screen.findByText('Sent 1, skipped 0, failed 0.')).toBeInTheDocument();
  });

  it('covers both open states when the filter asked for expired and pending', async () => {
    hoisted.getContactsEligibleForInvitation.mockResolvedValue([
      eligible('lapsed', 'lapsed@acme.com'),
      eligible('waiting', 'waiting@acme.com'),
      eligible('never', 'never@acme.com'),
    ]);
    hoisted.getPortalInvitationStatesForClient.mockResolvedValue([
      { contactId: 'lapsed', state: 'expired', expiresAt: null },
      { contactId: 'waiting', state: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' },
      { contactId: 'never', state: 'none', expiresAt: null },
    ]);

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'invitationState', states: ['expired', 'pending'] }}
        statusFilter="all"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    expect(await screen.findByText('Resend 2 expired or pending invitations')).toBeInTheDocument();
    // An invitation-state resend is the server's own set: active contacts only.
    expect(hoisted.getContactsEligibleForInvitation).toHaveBeenCalledWith('acme', 'active');
  });

  // The read refuses (or fails) while a state resend is open: with no states
  // there is nothing to count, so the dialog has to say that rather than sit on
  // "Checking who can be invited..." with Send disabled and no reason given.
  it('reports a refused invitation-state read instead of loading forever', async () => {
    hoisted.getContactsEligibleForInvitation.mockResolvedValue([eligible('lapsed', 'lapsed@acme.com')]);
    hoisted.getPortalInvitationStatesForClient.mockResolvedValue(null);

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'invitationState', states: ['expired'] }}
        statusFilter="all"
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    expect(await screen.findByText(
      'Could not read which invitations are outstanding for this client.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Checking who can be invited...')).not.toBeInTheDocument();
    expect(hoisted.sendBulkPortalInvitations).not.toHaveBeenCalled();
  });
});

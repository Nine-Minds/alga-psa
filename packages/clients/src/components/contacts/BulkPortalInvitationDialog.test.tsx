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
  sendBulkPortalInvitations: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
    let text = options?.defaultValue ?? key;
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/clients/actions', () => ({
  getContactsEligibleForInvitation: hoisted.getContactsEligibleForInvitation,
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
});

describe('BulkPortalInvitationDialog', () => {
  it('counts the invitable, names the skip reasons and sends only the invitable', async () => {
    hoisted.sendBulkPortalInvitations.mockResolvedValue({
      success: true, total: 1, sent: 1, skipped: 0, failed: 0,
      results: [{ contactId: 'fine', email: 'fine@acme.com', status: 'sent' }],
    });

    render(
      <BulkPortalInvitationDialog
        isOpen
        clientId="acme"
        target={{ mode: 'selected', contactIds: ['fine', 'no-email', 'shared', 'already-a-user'] }}
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

    await waitFor(() => expect(hoisted.sendBulkPortalInvitations).toHaveBeenCalledWith({
      clientId: 'acme',
      contactIds: ['fine'],
    }));
    expect(await screen.findByText('Sent 1, skipped 0, failed 0.')).toBeInTheDocument();
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
        contacts={[]}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText('Send 1 invitations'));

    await waitFor(() => expect(hoisted.sendBulkPortalInvitations).toHaveBeenCalledWith({
      clientId: 'acme',
      allEligible: true,
    }));
    expect(await screen.findByText('Sent 1, skipped 2, failed 0.')).toBeInTheDocument();
  });
});

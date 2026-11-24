/**
 * @vitest-environment jsdom
 *
 * alga0002338: a full edit save from the quick-view bento layout is a
 * "changes saved" event, so it must fire onChangesSaved (the client Contacts
 * tab relies on it to drop a contact that moved to another client).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactBentoLayout from './ContactBentoLayout';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  getClientById: vi.fn(),
  getContactPortalSummary: vi.fn(),
}));

// Stable references: the layout lists these in effect dependencies.
vi.mock('@alga-psa/ui', () => {
  const toast = vi.fn();
  const drawer = { openDrawer: hoisted.openDrawer, closeDrawer: hoisted.closeDrawer };
  const toastApi = { toast };
  return { useDrawer: () => drawer, useToast: () => toastApi };
});
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  const value = { t };
  return { useTranslation: () => value };
});
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => {
  const value = { renderDocuments: () => null, getDocumentsByEntity: vi.fn() };
  return { useDocumentsCrossFeature: () => value };
});
vi.mock('@alga-psa/clients/actions', () => ({
  updateContact: vi.fn(),
  getClientById: hoisted.getClientById,
  getContactPortalSummary: hoisted.getContactPortalSummary,
  getInteractionsForEntity: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/contacts/contact-1',
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ usePageCreateShortcut: () => undefined }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => isOpen ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('../../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => null }));
vi.mock('../../interactions/QuickAddInteraction', () => ({ QuickAddInteraction: () => null }));
vi.mock('../../interactions/InteractionDetails', () => ({ default: () => null }));
vi.mock('../ContactPortalTab', () => ({
  ContactPortalTab: ({ onInvitationChanged }: any) => (
    <button onClick={() => onInvitationChanged?.()}>Complete invitation change</button>
  ),
}));
vi.mock('../ContactCredentialsSection', () => ({ ContactCredentialsSection: () => null }));
vi.mock('../ContactDetailsEdit', () => ({ default: () => null }));

const contact: any = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Brian Linscott',
  email: 'brian@example.com',
  client_id: 'triage-id',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
};

describe('ContactBentoLayout full edit save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getClientById.mockResolvedValue({ client_id: 'triage-id', client_name: 'Looked Up Co' });
  });

  it('fires onChangesSaved and onContactUpdated when the edit drawer saves', () => {
    const onChangesSaved = vi.fn();
    const onContactUpdated = vi.fn();
    render(
      <ContactBentoLayout
        contact={contact}
        clientName="Triage Co"
        quickView
        onChangesSaved={onChangesSaved}
        onContactUpdated={onContactUpdated}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /edit contact/i })[0]);
    expect(hoisted.openDrawer).toHaveBeenCalledTimes(1);
    const drawerElement = hoisted.openDrawer.mock.calls[0][0] as React.ReactElement<any>;
    expect(onChangesSaved).not.toHaveBeenCalled();

    drawerElement.props.onSave({ ...contact, client_id: 'life-id' });

    expect(hoisted.closeDrawer).toHaveBeenCalledTimes(1);
    expect(onChangesSaved).toHaveBeenCalledTimes(1);
    expect(onContactUpdated).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['resend', 'expired', 'pending', 'Invitation sent', 'Portal · invited'],
    ['invite', 'none', 'pending', 'Invitation sent', 'Portal · invited'],
    ['revoke', 'pending', 'none', 'No access', 'No portal access'],
  ])('refreshes the full-page summary after %s without a parent callback', async (_action, before, after, status, chip) => {
    const summary = { hasAccount: false, lastSignIn: null, invitedAt: null, invitationState: before } as any;
    hoisted.getContactPortalSummary.mockResolvedValue({ ...summary, invitationState: after });
    render(<ContactBentoLayout contact={contact} clientName="Triage Co" portalSummary={summary} userPermissions={{ canRead: true, canInvite: true, canUpdateRoles: false }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete invitation change' }));

    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(screen.getByText(chip)).toBeInTheDocument();
    expect(hoisted.getContactPortalSummary).toHaveBeenCalledWith('contact-1');
    expect(screen.queryByText('Invitation expired')).not.toBeInTheDocument();
  });

  it('also notifies the contacts list after an invitation change in quick view', async () => {
    const onChangesSaved = vi.fn();
    hoisted.getContactPortalSummary.mockResolvedValue({ hasAccount: false, invitationState: 'pending' });
    render(<ContactBentoLayout contact={contact} clientName="Triage Co" quickView onChangesSaved={onChangesSaved} userPermissions={{ canRead: true, canInvite: true, canUpdateRoles: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete invitation change' }));
    expect(onChangesSaved).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
  });

  it('shows the supplied client name without a lookup', () => {
    render(<ContactBentoLayout contact={contact} clientName="Triage Co" quickView />);
    expect(screen.getByText('Triage Co')).toBeInTheDocument();
    expect(hoisted.getClientById).not.toHaveBeenCalled();
  });

  it('resolves the client name by id when the caller supplies none, never loading a client list', async () => {
    render(<ContactBentoLayout contact={contact} quickView />);
    expect(await screen.findByText('Looked Up Co')).toBeInTheDocument();
    expect(hoisted.getClientById).toHaveBeenCalledTimes(1);
    expect(hoisted.getClientById).toHaveBeenCalledWith('triage-id');
  });

  it('re-resolves the name when a save moves the contact to another client', async () => {
    render(<ContactBentoLayout contact={contact} clientName="Triage Co" quickView />);
    fireEvent.click(screen.getAllByRole('button', { name: /edit contact/i })[0]);
    const drawerElement = hoisted.openDrawer.mock.calls[0][0] as React.ReactElement<any>;
    hoisted.getClientById.mockResolvedValue({ client_id: 'life-id', client_name: 'Life Landscaping' });
    drawerElement.props.onSave({ ...contact, client_id: 'life-id' });
    await waitFor(() => expect(hoisted.getClientById).toHaveBeenCalledWith('life-id'));
    expect(await screen.findByText('Life Landscaping')).toBeInTheDocument();
    expect(screen.queryByText('Triage Co')).not.toBeInTheDocument();
  });
});

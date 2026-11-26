// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast, { Toaster } from 'react-hot-toast';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), create: vi.fn(), addContact: vi.fn(),
  t: (key: string, options?: any): string => options?.defaultValue ?? key,
}));
const contact = { contact_name_id: 'contact-1', full_name: 'Dorothy Gale', email: 'dorothy@example.com', client_id: 'client-1' };

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: () => ({ enabled: false, admitted: false, resolved: true }),
  useFeatureFlag: () => ({ enabled: false }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({ listCoManagedSeatTechniciansAction: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: vi.fn(async () => []), getUserWithRoles: vi.fn(),
  getMSPRoles: vi.fn(async () => [{ role_id: 'role-1', role_name: 'Admin' }]),
  getClientPortalRoles: vi.fn(async () => [{ role_id: 'role-1', role_name: 'Admin' }]),
}));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({ getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/users/actions/user-actions/userActions', () => ({ addUser: vi.fn() }));
vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({
  sendUserInvitation: vi.fn(), getUserInvitations: vi.fn(async () => []), revokeUserInvitation: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/queryActions', () => ({
  getContactsByClient: vi.fn(async () => [contact]), getAllContacts: vi.fn(async () => [contact]),
}));
vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({ searchClientsForPicker: vi.fn() }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({
  addContact: mocks.addContact, getContactsEligibleForInvitation: vi.fn(async () => [contact]),
}));
vi.mock('@alga-psa/client-portal/actions/portal-actions/portalInvitationActions', () => ({
  sendPortalInvitation: mocks.send, createClientPortalUser: mocks.create,
}));
vi.mock('@/lib/actions/licensingActions', () => ({ getLicenseUsageAction: vi.fn(async () => ({ success: false })) }));
vi.mock('@alga-psa/clients/components/contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ contacts, value, onValueChange }: any) => (
    <select aria-label="Existing contact" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Select contact</option>
      {contacts.map((item: any) => <option key={item.contact_name_id} value={item.contact_name_id}>{item.full_name}</option>)}
    </select>
  ),
}));
vi.mock('@/context/TierContext', () => ({ useTier: () => ({ isSolo: false }) }));
vi.mock('@/components/settings/general/CopyClientPortalLinkButton', () => ({ CopyClientPortalLinkButton: () => null }));
vi.mock('@/components/settings/general/org-chart/OrgChart', () => ({ default: () => null }));
vi.mock('@/components/settings/general/UserList', () => ({ default: () => null }));
vi.mock('@/components/settings/general/SeatTechnicianUsers', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: mocks.t }) }));

import UserManagement from '@/components/settings/general/UserManagement';

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ success: false, errorCode: 'INVITATION_FAILED', error: 'Failed to create invitation' });
  mocks.create.mockReset().mockResolvedValue({ success: false, errorCode: 'CREATE_USER_FAILED', error: 'Failed to create portal user' });
  mocks.addContact.mockReset().mockResolvedValue({ success: true, contact });
});
afterEach(() => { cleanup(); toast.remove(); });

async function openClientUserForm() {
  const view = render(<><UserManagement /><Toaster /></>);
  fireEvent.click(screen.getByRole('button', { name: mocks.t('users.viewSwitcher.clientPortal') }));
  fireEvent.click(await screen.findByRole('button', { name: mocks.t('users.actions.createNewClientUser') }));
  await screen.findByRole('option', { name: contact.full_name });
  return view.container;
}

for (const locale of ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']) {
  describe(`Users → Client Portal failure messages (${locale})`, () => {
    beforeEach(async () => {
      const dictionary = JSON.parse(readFileSync(resolve(__dirname, `../../../../../public/locales/${locale}/msp/settings.json`), 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: dictionary } }, interpolation: { escapeValue: false } });
      mocks.t = (key, options) => String(i18n.t(key, options));
    });

    it.each(['existing', 'new'])('renders the localized invitation failure for an %s contact', async (mode) => {
      const container = await openClientUserForm();
      if (mode === 'existing') {
        fireEvent.change(screen.getByLabelText('Existing contact'), { target: { value: contact.contact_name_id } });
      } else {
        fireEvent.change(container.querySelector('#first-name')!, { target: { value: 'Dorothy' } });
        fireEvent.change(container.querySelector('#last-name')!, { target: { value: 'Gale' } });
        fireEvent.change(container.querySelector('#email')!, { target: { value: contact.email } });
      }
      fireEvent.click(container.querySelector('#submit-new-client-user-btn')!);
      await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(contact.contact_name_id));
      expect(await screen.findByText(mocks.t('users.messages.error.sendInvitation'), {}, { timeout: 1000 })).toBeInTheDocument();
      expect(screen.queryByText('Failed to create invitation')).not.toBeInTheDocument();
      expect(mocks.addContact).toHaveBeenCalledTimes(mode === 'new' ? 1 : 0);
    });

    it('renders the localized direct portal-user creation failure', async () => {
      const container = await openClientUserForm();
      fireEvent.change(screen.getByLabelText('Existing contact'), { target: { value: contact.contact_name_id } });
      fireEvent.change(container.querySelector('#password')!, { target: { value: 'EmeraldCity42!' } });
      fireEvent.click(container.querySelector('#submit-new-client-user-btn')!);
      await waitFor(() => expect(mocks.create).toHaveBeenCalled());
      await waitFor(() => expect(screen.getAllByText(mocks.t('users.messages.error.createClientPortalUser')).length).toBeGreaterThan(0), { timeout: 1000 });
      expect(screen.queryByText('Failed to create portal user')).not.toBeInTheDocument();
    });
  });
}

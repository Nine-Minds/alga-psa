// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * User administration with the seat capability open lists seat technicians in their own section and keeps them
 * out of the staff list; closed, the screen is what it was: one list, and the seat read is never made.
 */
const capability = vi.hoisted(() => ({ open: false }));
const actions = vi.hoisted(() => ({ list: vi.fn(), users: vi.fn(), usage: vi.fn() }));

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: () => ({ enabled: capability.open, admitted: capability.open, resolved: true }),
  useFeatureFlag: () => ({ enabled: false }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  listCoManagedSeatTechniciansAction: actions.list,
  explainCoManagedSeatTicketAccessAction: vi.fn(),
  searchCoManagedSeatAccessTicketsAction: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: actions.users, getUserWithRoles: vi.fn(), getMSPRoles: vi.fn(async () => []), getClientPortalRoles: vi.fn(async () => []),
}));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({ getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/users/actions/user-actions/userActions', () => ({ addUser: vi.fn() }));
vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({
  sendUserInvitation: vi.fn(), getUserInvitations: vi.fn(async () => []), revokeUserInvitation: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/queryActions', () => ({ getAllClients: vi.fn(), getContactsByClient: vi.fn(), getAllContacts: vi.fn() }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ addContact: vi.fn(), getContactsEligibleForInvitation: vi.fn() }));
vi.mock('@alga-psa/client-portal/actions/portal-actions/portalInvitationActions', () => ({ sendPortalInvitation: vi.fn(), createClientPortalUser: vi.fn() }));
vi.mock('@alga-psa/licensing/actions/license-actions', () => ({ getLicenseUsageAction: actions.usage }));
vi.mock('@alga-psa/clients/components/contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/clients/lib/contactActionErrorCodes', () => ({ parseContactActionError: vi.fn() }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@/context/TierContext', () => ({ useTier: () => ({ isSolo: false }) }));
vi.mock('../../../components/settings/general/CopyClientPortalLinkButton', () => ({ CopyClientPortalLinkButton: () => null }));
vi.mock('../../../components/settings/general/org-chart/OrgChart', () => ({ default: () => null }));
vi.mock('../../../components/settings/general/UserList', () => ({
  default: ({ users }: any) => <ul aria-label="staff">{users.map((u: any) => <li key={u.user_id}>{u.first_name}</li>)}</ul>,
}));
vi.mock('../../../components/settings/general/SeatTechnicianUsers', () => ({
  default: ({ users, listings }: any) => <ul aria-label="seat technicians">{users.map((u: any) => <li key={u.user_id}>{u.first_name} / {listings[u.user_id].clientName}</li>)}</ul>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (o?.defaultValue ?? k) }),
}));

import UserManagement from '@/components/settings/general/UserManagement';

const person = (id: string, first: string) => ({ user_id: id, first_name: first, last_name: '', email: `${first}@x.io`, user_type: 'internal', is_inactive: false });

beforeEach(() => {
  capability.open = false;
  actions.users.mockReset().mockResolvedValue([person('u1', 'Alice'), person('u2', 'Dana')]);
  actions.usage.mockReset().mockResolvedValue({ success: true, data: { used: 1, limit: 5, remaining: 4 } });
  actions.list.mockReset().mockResolvedValue([{ userId: 'u2', clientName: 'Acme Co', state: 'active' }]);
});
afterEach(cleanup);

describe('user administration and seat technicians', () => {
  it('capability closed: one staff list, no seat section, and the seat read is never made', async () => {
    render(<UserManagement />);
    await waitFor(() => expect(screen.getByLabelText('staff')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.queryByLabelText('seat technicians')).not.toBeInTheDocument();
    expect(actions.list).not.toHaveBeenCalled();
  });

  it('capability open: the seat technician leaves the staff list and appears in their own section with the client name', async () => {
    capability.open = true;
    render(<UserManagement />);
    await waitFor(() => expect(screen.getByLabelText('seat technicians')).toBeInTheDocument());
    expect(screen.getByText('Dana / Acme Co')).toBeInTheDocument();
    const staff = screen.getByLabelText('staff');
    expect(staff.textContent).toContain('Alice');
    expect(staff.textContent).not.toContain('Dana');
  });

  it('licence usage comes from the shared licence action either way, never a count of the lists', async () => {
    capability.open = true;
    render(<UserManagement />);
    // The banner is rendered from the shared licence action's figure (the mock translator shows the key).
    await waitFor(() => expect(screen.getByText('users.license.usage')).toBeInTheDocument());
    expect(actions.usage).toHaveBeenCalled();
  });
});

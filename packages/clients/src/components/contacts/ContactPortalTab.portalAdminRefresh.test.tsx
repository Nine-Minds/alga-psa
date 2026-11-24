/**
 * @vitest-environment jsdom
 *
 * alga-2026-0003347: once a portal user exists, `contacts.is_client_admin` is a
 * mirror of their client 'Admin' role. The portal tab is where that role is
 * added and removed, and the contact screen around it prints the flag
 * ("Client admin" / "Standard") from a prop — so without a callback the screen
 * kept showing the old answer until a reload.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPortalTab } from './ContactPortalTab';

const getUserByContactIdMock = vi.fn();
const getRolesMock = vi.fn();
const getPortalInvitationsMock = vi.fn();
const assignRoleToUserMock = vi.fn();
const removeRoleFromUserMock = vi.fn();
const updateContactPortalAdminStatusMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@alga-psa/ui', () => ({
  useToast: () => ({ toast: (...args: any[]) => toastMock(...args) }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, type = 'button', disabled, ...props }: any) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, disabled }: any) => (
    <input
      aria-label="switch"
      type="checkbox"
      checked={checked}
      onChange={() => onCheckedChange?.(!checked)}
      disabled={disabled}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor, className }: any) => (
    <label htmlFor={htmlFor} className={className}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder, disabled }: any) => (
    <select
      data-testid={id}
      aria-label={placeholder ?? id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ checked, onChange, onCheckedChange, disabled, id }: any) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(event) => {
        onChange?.(event);
        onCheckedChange?.(!checked);
      }}
      disabled={disabled}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: (props: any) => <textarea {...props} /> }));
vi.mock('@alga-psa/ui/components/skeletons/SettingsTabSkeleton', () => ({ default: () => <div>Loading</div> }));

vi.mock('lucide-react', () => ({
  Mail: () => <span />,
  Shield: () => <span />,
  User: () => <span />,
  Info: () => <span />,
  RefreshCw: () => <span />,
}));

vi.mock('./PortalBillingProfileAccess', () => ({ PortalBillingProfileAccess: () => null }));
vi.mock('./ContactBillingProfileAssociations', () => ({ ContactBillingProfileAssociations: () => null }));

vi.mock('../../actions/contact-actions/contactActions', () => ({
  updateContactPortalAdminStatus: (...args: any[]) => updateContactPortalAdminStatusMock(...args),
  getUserByContactId: (...args: any[]) => getUserByContactIdMock(...args),
  getContactReportCount: async () => 0,
  getClientPortalVisibilityBoardsByClient: async () => [],
  getClientPortalVisibilityGroupById: async () => null,
  getClientPortalVisibilityGroupsForContact: async () => [],
  getClientPortalVisibilityGroupAssignmentForContact: async () => null,
  assignClientPortalVisibilityGroupToContact: async () => undefined,
  createClientPortalVisibilityGroupForContact: async () => undefined,
  updateClientPortalVisibilityGroupForContact: async () => undefined,
  deleteClientPortalVisibilityGroupForContact: async () => undefined,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  assignRoleToUser: (...args: any[]) => assignRoleToUserMock(...args),
  removeRoleFromUser: (...args: any[]) => removeRoleFromUserMock(...args),
  getRoles: (...args: any[]) => getRolesMock(...args),
}));

vi.mock('../../actions/contact-actions/portalInvitationBridgeActions', () => ({
  sendPortalInvitation: async () => ({ success: true }),
  getPortalInvitations: (...args: any[]) => getPortalInvitationsMock(...args),
  revokePortalInvitation: vi.fn(),
  updateClientUser: vi.fn(),
}));

const CLIENT_ADMIN = { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false };
const CLIENT_USER = { role_id: 'client-user', role_name: 'User', client: true, msp: false };

const contact = {
  contact_name_id: 'contact-1',
  full_name: 'Taylor Client',
  email: 'taylor@example.com',
  client_id: 'client-1',
  // The flag the screen was rendering before the role change.
  is_client_admin: true,
} as any;

describe('ContactPortalTab portal-admin refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRolesMock.mockResolvedValue([CLIENT_ADMIN, CLIENT_USER]);
    getPortalInvitationsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('reports the flag the roles imply when the tab loads a portal user', async () => {
    getUserByContactIdMock.mockResolvedValue({
      user: { user_id: 'user-1', roles: [CLIENT_ADMIN, CLIENT_USER] },
    });
    const onPortalAdminChanged = vi.fn();

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
        onPortalAdminChanged={onPortalAdminChanged}
      />
    );

    await waitFor(() => {
      expect(onPortalAdminChanged).toHaveBeenCalledWith(true);
    });
  });

  it.each([
    { role_name: 'aDmIn', client: true, msp: true, expected: true },
    { role_name: 'Admin', client: false, msp: true, expected: false },
  ])('uses the authoritative Admin predicate for $role_name client=$client msp=$msp', async ({ expected, ...role }) => {
    const assignedRole = { role_id: 'dual-scope-admin', ...role };
    getRolesMock.mockResolvedValue([assignedRole, CLIENT_USER]);
    getUserByContactIdMock.mockResolvedValue({ user: { user_id: 'user-1', roles: [assignedRole] } });
    const onPortalAdminChanged = vi.fn();

    render(<ContactPortalTab contact={contact}
      currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
      onPortalAdminChanged={onPortalAdminChanged} />);

    await waitFor(() => expect(onPortalAdminChanged).toHaveBeenCalledWith(expected));
    expect(onPortalAdminChanged).not.toHaveBeenCalledWith(!expected);
  });

  it('reports the flag as false once the client Admin role is removed', async () => {
    getUserByContactIdMock
      .mockResolvedValueOnce({ user: { user_id: 'user-1', roles: [CLIENT_ADMIN, CLIENT_USER] } })
      .mockResolvedValue({ user: { user_id: 'user-1', roles: [CLIENT_USER] } });
    removeRoleFromUserMock.mockResolvedValue({ success: true });
    const onPortalAdminChanged = vi.fn();

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
        onPortalAdminChanged={onPortalAdminChanged}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    });

    // Remove the Admin role row (two roles, so removal is offered).
    const removeButtons = screen.getAllByText('Remove');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(removeRoleFromUserMock).toHaveBeenCalledWith('user-1', 'client-admin');
    });
    await waitFor(() => {
      expect(onPortalAdminChanged).toHaveBeenLastCalledWith(false);
    });
  });

  it('reports the pre-mark the toggle writes while no portal user exists', async () => {
    getUserByContactIdMock.mockResolvedValue({ user: null });
    updateContactPortalAdminStatusMock.mockResolvedValue({ success: true });
    const onPortalAdminChanged = vi.fn();

    render(
      <ContactPortalTab
        contact={{ ...contact, is_client_admin: false }}
        currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
        onPortalAdminChanged={onPortalAdminChanged}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('switch')).toBeInTheDocument();
    });
    // No portal user: the flag is still the pre-mark, so loading reports nothing.
    expect(onPortalAdminChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('switch'));

    await waitFor(() => {
      expect(onPortalAdminChanged).toHaveBeenCalledWith(true);
    });
  });
});

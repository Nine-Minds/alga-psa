/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementSettings } from './UserManagementSettings';
import ClientUserDetails from './ClientUserDetails';

const openDrawerMock = vi.fn();
const closeDrawerMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getUserRolesWithPermissionsMock = vi.fn();
const getUserClientIdMock = vi.fn();
const getClientUsersForClientMock = vi.fn();
const getClientPortalRolesMock = vi.fn();
const getClientUserRolesMock = vi.fn();
const getClientUserByIdMock = vi.fn();
const getClientUserManagerOptionsMock = vi.fn();

const USER_ID = 'user-ada';
const ROLE_NAME = 'Client Admin Role Text';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock, closeDrawer: closeDrawerMock }),
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

// Leaf UI only: Radix dropdown portals are awkward in jsdom. The real DataTable is used.
vi.mock('@alga-psa/ui/components/DropdownMenu', () => {
  const Ctx = React.createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    DropdownMenu: ({ children }: any) => {
      const [open, setOpen] = React.useState(false);
      return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
    },
    DropdownMenuTrigger: ({ children }: any) => {
      const { open, setOpen } = React.useContext(Ctx);
      return React.cloneElement(children, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children }: any) => {
      const { open } = React.useContext(Ctx);
      return open ? <div role="menu">{children}</div> : null;
    },
    DropdownMenuItem: ({ children, onClick, id }: any) => (
      <div role="menuitem" id={id} onClick={onClick}>{children}</div>
    ),
  };
});

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, type = 'button', variant, ...props }: any) => (
    <button type={type} onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value }: any) => <select id={id} value={value} onChange={() => {}}><option value={value}>{value}</option></select>,
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: (...a: any[]) => getCurrentUserMock(...a),
  getUserRolesWithPermissions: (...a: any[]) => getUserRolesWithPermissionsMock(...a),
  getUserClientId: (...a: any[]) => getUserClientIdMock(...a),
  getClientUsersForClient: (...a: any[]) => getClientUsersForClientMock(...a),
}));

vi.mock('@alga-psa/users/actions/user-actions/userActions', () => ({
  deactivateUserWithDisposition: vi.fn(),
  deleteUser: vi.fn(),
  getActiveInternalUsersForDeactivation: vi.fn(),
  getOpenWorkCountsForUserDeactivation: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions/queryActions', () => ({
  createOrFindContactByEmail: vi.fn(),
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

vi.mock('../../actions/client-portal-actions/clientUserActions', () => ({
  createClientUser: vi.fn(),
  getClientPortalRoles: (...a: any[]) => getClientPortalRolesMock(...a),
  getClientUserRoles: (...a: any[]) => getClientUserRolesMock(...a),
  getClientUserById: (...a: any[]) => getClientUserByIdMock(...a),
  getClientUserManagerOptions: (...a: any[]) => getClientUserManagerOptionsMock(...a),
  updateClientUser: vi.fn(),
  resetClientUserPassword: vi.fn(),
  assignClientUserRole: vi.fn(),
  removeClientUserRole: vi.fn(),
}));

const user = {
  user_id: USER_ID,
  first_name: 'Ada',
  last_name: 'Admin',
  email: 'ada.admin.2577@example.test',
  phone: '',
  is_inactive: false,
  last_login_at: null,
};

describe('UserManagementSettings actions column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ user_id: USER_ID, roles: [] });
    getUserRolesWithPermissionsMock.mockResolvedValue([
      { permissions: [{ resource: 'user', action: 'update' }] },
    ]);
    getUserClientIdMock.mockResolvedValue('client-1');
    getClientUsersForClientMock.mockResolvedValue([user]);
    getClientPortalRolesMock.mockResolvedValue([]);
    getClientUserRolesMock.mockResolvedValue([{ role_id: 'r1', role_name: ROLE_NAME }]);
    getClientUserByIdMock.mockResolvedValue(user);
    getClientUserManagerOptionsMock.mockResolvedValue({
      options: [{ contact_name_id: 'c2', full_name: 'Grace Manager' }],
      managerContactId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the per-user actions menu in the Actions cell, not the roles text', async () => {
    render(<UserManagementSettings />);

    const trigger = await waitFor(() => {
      const el = document.querySelector(`#user-actions-menu-${USER_ID}`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(trigger.closest('table')).not.toBeNull();

    const actionsCell = trigger.closest('td') as HTMLElement;
    expect(actionsCell).not.toBeNull();
    expect(within(actionsCell).queryByText(ROLE_NAME)).toBeNull();
    // Roles text still renders in its own column.
    await waitFor(() => expect(screen.getByText(ROLE_NAME)).toBeTruthy());
  });

  it('opens ClientUserDetails with the Reports-to select from the Edit menu item', async () => {
    render(<UserManagementSettings />);

    const trigger = await waitFor(() => {
      const el = document.querySelector(`#user-actions-menu-${USER_ID}`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(trigger);

    const editItem = document.querySelector(`#edit-user-menu-item-${USER_ID}`) as HTMLElement;
    expect(editItem).not.toBeNull();
    fireEvent.click(editItem);

    expect(openDrawerMock).toHaveBeenCalledTimes(1);
    const element = openDrawerMock.mock.calls[0][0] as React.ReactElement<any>;
    expect(element.type).toBe(ClientUserDetails);
    expect(element.props.userId).toBe(USER_ID);

    cleanup();
    render(element);
    await waitFor(() => {
      expect(document.querySelector(`#user-${USER_ID}-reports-to`)).not.toBeNull();
    });
  });
});

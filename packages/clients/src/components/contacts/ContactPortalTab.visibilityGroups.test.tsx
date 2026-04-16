/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPortalTab } from './ContactPortalTab';

const getUserByContactIdMock = vi.fn();
const getClientPortalVisibilityBoardsByClientMock = vi.fn();
const getClientPortalVisibilityGroupByIdMock = vi.fn();
const getClientPortalVisibilityGroupsForContactMock = vi.fn();
const assignClientPortalVisibilityGroupToContactMock = vi.fn();
const createClientPortalVisibilityGroupForContactMock = vi.fn();
const updateClientPortalVisibilityGroupForContactMock = vi.fn();
const deleteClientPortalVisibilityGroupForContactMock = vi.fn();
const getRolesMock = vi.fn();
const getPortalInvitationsMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@alga-psa/ui', () => ({
  useToast: () => ({
    toast: (...args: any[]) => toastMock(...args),
  }),
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
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
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
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
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

vi.mock('lucide-react', () => ({
  Mail: () => <span />,
  Shield: () => <span />,
  User: () => <span />,
  Info: () => <span />,
  RefreshCw: () => <span />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, disabled }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onCheckedChange?.(!checked)}
      disabled={disabled}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/skeletons/SettingsTabSkeleton', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('../../actions/contact-actions/contactActions', () => ({
  updateContactPortalAdminStatus: vi.fn(),
  getUserByContactId: (...args: any[]) => getUserByContactIdMock(...args),
  getClientPortalVisibilityBoardsByClient: (...args: any[]) =>
    getClientPortalVisibilityBoardsByClientMock(...args),
  getClientPortalVisibilityGroupById: (...args: any[]) =>
    getClientPortalVisibilityGroupByIdMock(...args),
  getClientPortalVisibilityGroupsForContact: (...args: any[]) =>
    getClientPortalVisibilityGroupsForContactMock(...args),
  assignClientPortalVisibilityGroupToContact: (...args: any[]) =>
    assignClientPortalVisibilityGroupToContactMock(...args),
  createClientPortalVisibilityGroupForContact: (...args: any[]) =>
    createClientPortalVisibilityGroupForContactMock(...args),
  updateClientPortalVisibilityGroupForContact: (...args: any[]) =>
    updateClientPortalVisibilityGroupForContactMock(...args),
  deleteClientPortalVisibilityGroupForContact: (...args: any[]) =>
    deleteClientPortalVisibilityGroupForContactMock(...args),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  assignRoleToUser: vi.fn(),
  removeRoleFromUser: vi.fn(),
  getRoles: (...args: any[]) => getRolesMock(...args),
}));

vi.mock('../../actions/contact-actions/portalInvitationBridgeActions', () => ({
  sendPortalInvitation: vi.fn(),
  getPortalInvitations: (...args: any[]) => getPortalInvitationsMock(...args),
  revokePortalInvitation: vi.fn(),
  updateClientUser: vi.fn(),
}));

const contact = {
  contact_name_id: 'contact-1',
  full_name: 'Taylor Client',
  email: 'taylor@example.com',
  is_client_admin: false,
  portal_visibility_group_id: 'group-1',
} as any;

describe('ContactPortalTab visibility groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByContactIdMock.mockResolvedValue({ user: null });
    getRolesMock.mockResolvedValue([]);
    getPortalInvitationsMock.mockResolvedValue([]);
    getClientPortalVisibilityBoardsByClientMock.mockResolvedValue([
      { board_id: 'board-1', board_name: 'Support' },
      { board_id: 'board-2', board_name: 'HR' },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T029: MSP staff can view and replace the effective visibility group from the PSA contact portal tab', async () => {
    getClientPortalVisibilityGroupsForContactMock.mockResolvedValue([
      { group_id: 'group-1', name: 'Standard', description: null, board_count: 1 },
      { group_id: 'group-2', name: 'HR', description: null, board_count: 2 },
    ]);
    assignClientPortalVisibilityGroupToContactMock.mockResolvedValue(undefined);

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('visibility-group-assignment')).toHaveValue('group-1');
    });

    fireEvent.change(screen.getByTestId('visibility-group-assignment'), {
      target: { value: 'group-2' },
    });

    await waitFor(() => {
      expect(assignClientPortalVisibilityGroupToContactMock).toHaveBeenCalledWith('contact-1', 'group-2');
    });
  });

  it('T030: MSP staff can create and edit per-client visibility groups from the PSA contact portal tab', async () => {
    getClientPortalVisibilityGroupsForContactMock
      .mockResolvedValueOnce([
        { group_id: 'group-1', name: 'Standard', description: 'Default boards', board_count: 1 },
      ])
      .mockResolvedValueOnce([
        { group_id: 'group-1', name: 'Standard', description: 'Default boards', board_count: 1 },
        { group_id: 'group-2', name: 'HR', description: 'HR-only boards', board_count: 1 },
      ])
      .mockResolvedValueOnce([
        { group_id: 'group-1', name: 'Standard', description: 'Default boards', board_count: 1 },
        { group_id: 'group-2', name: 'HR Leaders', description: 'HR-only boards', board_count: 1 },
      ]);
    createClientPortalVisibilityGroupForContactMock.mockResolvedValue({ group_id: 'group-2' });
    getClientPortalVisibilityGroupByIdMock.mockResolvedValue({
      group_id: 'group-2',
      name: 'HR',
      description: 'HR-only boards',
      board_ids: ['board-2'],
    });
    updateClientPortalVisibilityGroupForContactMock.mockResolvedValue(undefined);

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Standard')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'HR' },
    });
    fireEvent.click(screen.getByLabelText('HR'));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => {
      expect(createClientPortalVisibilityGroupForContactMock).toHaveBeenCalledWith('contact-1', {
        name: 'HR',
        description: null,
        boardIds: ['board-2'],
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);

    await waitFor(() => {
      expect(getClientPortalVisibilityGroupByIdMock).toHaveBeenCalledWith('contact-1', 'group-2');
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('HR')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'HR Leaders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update group' }));

    await waitFor(() => {
      expect(updateClientPortalVisibilityGroupForContactMock).toHaveBeenCalledWith(
        'contact-1',
        'group-2',
        {
          name: 'HR Leaders',
          description: 'HR-only boards',
          boardIds: ['board-2'],
        }
      );
    });
  });
});

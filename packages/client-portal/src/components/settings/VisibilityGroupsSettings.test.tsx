/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisibilityGroupsSettings } from './VisibilityGroupsSettings';

const toastMock = vi.fn();
const getClientPortalVisibilityGroupsMock = vi.fn();
const getClientPortalVisibilityContactsMock = vi.fn();
const getClientPortalVisibilityGroupBoardsMock = vi.fn();
const deleteClientPortalVisibilityGroupMock = vi.fn();
const assignClientPortalVisibilityGroupToContactMock = vi.fn();
const createClientPortalVisibilityGroupMock = vi.fn();
const getClientPortalVisibilityGroupMock = vi.fn();
const updateClientPortalVisibilityGroupMock = vi.fn();

vi.mock('@alga-psa/ui', () => ({
  useToast: () => ({
    toast: (...args: any[]) => toastMock(...args),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, type = 'button', disabled, ...props }: any) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, message, onConfirm, onClose, confirmLabel = 'Confirm', cancelLabel = 'Cancel', id }: any) =>
    isOpen ? (
      <div data-testid={id || 'confirmation-dialog'}>
        <div>{title}</div>
        <div>{message}</div>
        <button onClick={onClose}>{cancelLabel}</button>
        <button onClick={() => onConfirm()}>{confirmLabel}</button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  assignClientPortalVisibilityGroupToContact: (...args: any[]) =>
    assignClientPortalVisibilityGroupToContactMock(...args),
  createClientPortalVisibilityGroup: (...args: any[]) =>
    createClientPortalVisibilityGroupMock(...args),
  deleteClientPortalVisibilityGroup: (...args: any[]) =>
    deleteClientPortalVisibilityGroupMock(...args),
  getClientPortalVisibilityContacts: (...args: any[]) =>
    getClientPortalVisibilityContactsMock(...args),
  getClientPortalVisibilityGroup: (...args: any[]) =>
    getClientPortalVisibilityGroupMock(...args),
  getClientPortalVisibilityGroupBoards: (...args: any[]) =>
    getClientPortalVisibilityGroupBoardsMock(...args),
  getClientPortalVisibilityGroups: (...args: any[]) =>
    getClientPortalVisibilityGroupsMock(...args),
  updateClientPortalVisibilityGroup: (...args: any[]) =>
    updateClientPortalVisibilityGroupMock(...args),
}));

const group = {
  group_id: 'group-1',
  client_id: 'client-1',
  name: 'Assigned Empty Group',
  description: null,
  board_ids: [],
  board_count: 0,
  assigned_contact_count: 1,
};

const contact = {
  contact_name_id: 'contact-1',
  full_name: 'Restricted User 0415',
  email: 'restricted.user.0415@emeraldcity.oz',
  is_client_admin: false,
  portal_visibility_group_id: 'group-1',
};

describe('VisibilityGroupsSettings behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getClientPortalVisibilityGroupsMock.mockResolvedValue([group]);
    getClientPortalVisibilityContactsMock.mockResolvedValue([contact]);
    getClientPortalVisibilityGroupBoardsMock.mockResolvedValue([
      { board_id: 'board-1', board_name: 'General Support' },
    ]);
    assignClientPortalVisibilityGroupToContactMock.mockResolvedValue(undefined);
    createClientPortalVisibilityGroupMock.mockResolvedValue(undefined);
    getClientPortalVisibilityGroupMock.mockResolvedValue(null);
    updateClientPortalVisibilityGroupMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a specific delete error toast without reloading when the server returns a validation result', async () => {
    deleteClientPortalVisibilityGroupMock.mockResolvedValue({
      ok: false,
      code: 'ASSIGNED_TO_CONTACTS',
    });

    render(<VisibilityGroupsSettings />);

    await waitFor(() => {
      expect(screen.getByText('Assigned Empty Group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByTestId('visibility-group-delete-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Delete visibility group')).toBeInTheDocument();
    expect(screen.getByText('Delete this visibility group?')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('visibility-group-delete-confirmation')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() => {
      expect(deleteClientPortalVisibilityGroupMock).toHaveBeenCalledWith('group-1');
    });
    expect(toastMock).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Unable to delete visibility group',
      description: 'This visibility group is still assigned to one or more contacts.',
    });
    expect(getClientPortalVisibilityGroupsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Assigned Empty Group')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned group')).toHaveValue('group-1');
  });

  it('refreshes group counts and assignments after a successful assignment change', async () => {
    const refreshedGroup = {
      ...group,
      assigned_contact_count: 0,
    };
    const refreshedContact = {
      ...contact,
      portal_visibility_group_id: null,
    };

    getClientPortalVisibilityGroupsMock
      .mockResolvedValueOnce([group])
      .mockResolvedValueOnce([refreshedGroup]);
    getClientPortalVisibilityContactsMock
      .mockResolvedValueOnce([contact])
      .mockResolvedValueOnce([refreshedContact]);

    render(<VisibilityGroupsSettings />);

    await waitFor(() => {
      expect(screen.getByText('Assigned Empty Group')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Assigned group'), {
      target: { value: '__full_access__' },
    });

    await waitFor(() => {
      expect(assignClientPortalVisibilityGroupToContactMock).toHaveBeenCalledWith({
        contactId: 'contact-1',
        groupId: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('0 boards · 0 assigned contacts')).toBeInTheDocument();
    });

    expect(toastMock).toHaveBeenCalledWith({
      title: 'Contact visibility assignment updated',
    });
    expect(screen.getByLabelText('Assigned group')).toHaveValue('__full_access__');
  });

  it('reloads and shows the success toast when delete succeeds', async () => {
    getClientPortalVisibilityGroupsMock
      .mockResolvedValueOnce([group])
      .mockResolvedValueOnce([]);
    deleteClientPortalVisibilityGroupMock.mockResolvedValue({ ok: true });

    render(<VisibilityGroupsSettings />);

    await waitFor(() => {
      expect(screen.getByText('Assigned Empty Group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByTestId('visibility-group-delete-confirmation')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('visibility-group-delete-confirmation')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() => {
      expect(deleteClientPortalVisibilityGroupMock).toHaveBeenCalledWith('group-1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Assigned Empty Group')).not.toBeInTheDocument();
    });

    expect(toastMock).toHaveBeenCalledWith({
      title: 'Visibility group deleted',
    });
    expect(getClientPortalVisibilityGroupsMock).toHaveBeenCalledTimes(2);
  });
});

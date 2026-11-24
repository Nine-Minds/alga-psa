/**
 * @vitest-environment jsdom
 *
 * Acting on an invitation in this tab changes what the screen that opened it
 * shows for the contact — the client's contact list carries an invitation-state
 * column — so the tab tells its opener, and the history says when an
 * invitation was last mailed rather than only when it was first created.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPortalTab } from './ContactPortalTab';

const getUserByContactIdMock = vi.fn();
const getRolesMock = vi.fn();
const getPortalInvitationsMock = vi.fn();
const sendPortalInvitationMock = vi.fn();
const revokePortalInvitationMock = vi.fn();

vi.mock('@alga-psa/ui', () => ({ useToast: () => ({ toast: vi.fn() }) }));
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
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => <input type="checkbox" /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => <select /> }));
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
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
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
// Covered by their own suites; loading them here drags the full UI barrel in.
vi.mock('./PortalBillingProfileAccess', () => ({ PortalBillingProfileAccess: () => null }));
vi.mock('./ContactBillingProfileAssociations', () => ({ ContactBillingProfileAssociations: () => null }));

vi.mock('../../actions/contact-actions/contactActions', () => ({
  updateContactPortalAdminStatus: vi.fn(),
  getUserByContactId: (...args: any[]) => getUserByContactIdMock(...args),
  getContactReportCount: async () => 0,
  getClientPortalVisibilityBoardsByClient: async () => [],
  getClientPortalVisibilityGroupById: vi.fn(),
  getClientPortalVisibilityGroupsForContact: async () => [],
  getClientPortalVisibilityGroupAssignmentForContact: async () => null,
  assignClientPortalVisibilityGroupToContact: vi.fn(),
  createClientPortalVisibilityGroupForContact: vi.fn(),
  updateClientPortalVisibilityGroupForContact: vi.fn(),
  deleteClientPortalVisibilityGroupForContact: vi.fn(),
}));
vi.mock('@alga-psa/auth/actions', () => ({
  assignRoleToUser: vi.fn(),
  removeRoleFromUser: vi.fn(),
  getRoles: (...args: any[]) => getRolesMock(...args),
}));
vi.mock('../../actions/contact-actions/portalInvitationBridgeActions', () => ({
  sendPortalInvitation: (...args: any[]) => sendPortalInvitationMock(...args),
  getPortalInvitations: (...args: any[]) => getPortalInvitationsMock(...args),
  revokePortalInvitation: (...args: any[]) => revokePortalInvitationMock(...args),
  updateClientUser: vi.fn(),
}));

const contact = {
  contact_name_id: 'contact-1',
  full_name: 'Taylor Client',
  email: 'taylor@example.com',
  client_id: 'client-1',
  is_client_admin: false,
} as any;

const permissions = { canInvite: true, canUpdateRoles: true, canRead: true };

beforeEach(() => {
  vi.clearAllMocks();
  getUserByContactIdMock.mockResolvedValue({ user: null });
  getRolesMock.mockResolvedValue([]);
  getPortalInvitationsMock.mockResolvedValue([]);
  sendPortalInvitationMock.mockResolvedValue({ success: true });
  revokePortalInvitationMock.mockResolvedValue({ success: true });
});

afterEach(() => cleanup());

describe('ContactPortalTab invitation changes', () => {
  it('tells its opener after an invitation is sent', async () => {
    const onInvitationChanged = vi.fn();

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={permissions}
        onInvitationChanged={onInvitationChanged}
      />
    );

    fireEvent.click(await screen.findByText('Send Portal Invitation'));

    await waitFor(() => expect(onInvitationChanged).toHaveBeenCalled());
  });

  it('tells its opener after a resend and after a revoke', async () => {
    getPortalInvitationsMock.mockResolvedValue([{
      invitation_id: 'invitation-1',
      email: 'taylor@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2099-01-08T00:00:00.000Z',
      status: 'pending',
    }]);
    const onInvitationChanged = vi.fn();

    render(
      <ContactPortalTab
        contact={contact}
        currentUserPermissions={permissions}
        onInvitationChanged={onInvitationChanged}
      />
    );

    fireEvent.click(await screen.findByText('Resend'));
    await waitFor(() => expect(onInvitationChanged).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Revoke'));
    await waitFor(() => expect(onInvitationChanged).toHaveBeenCalledTimes(2));
  });

  it('shows when a renewed invitation was last sent', async () => {
    getPortalInvitationsMock.mockResolvedValue([{
      invitation_id: 'invitation-1',
      email: 'taylor@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2099-01-08T00:00:00.000Z',
      last_sent_at: '2026-01-05T09:30:00.000Z',
      resend_count: 2,
      status: 'pending',
    }]);

    render(<ContactPortalTab contact={contact} currentUserPermissions={permissions} />);

    // A resend renews this same row, so "Sent" alone would date the invitation
    // to the day it was created however often it went out since.
    expect(await screen.findByText(/Last sent:/)).toBeInTheDocument();
    // And how often: the count is stored on the row, so the history shows it
    // instead of leaving one resend and five looking the same.
    expect(screen.getByText(/sent again 2 times/)).toBeInTheDocument();
  });
});

describe('the contact drawer', () => {
  it('passes the invitation-change callback down to the portal tab', () => {
    // The drawer is what the client's contact list opens, and that list is
    // where the stale invitation state would be seen.
    const source = readFileSync(resolve(__dirname, 'bento/ContactBentoLayout.tsx'), 'utf8');

    expect(source).toContain('onInvitationChanged={onChangesSaved}');
  });
});

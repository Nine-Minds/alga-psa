/**
 * @vitest-environment jsdom
 *
 * The client Contacts tab's bulk portal invitation affordances: a per-row
 * checkbox, a header box that covers exactly the filtered set, and the two
 * entry points ("Invite to portal (N)" for the selection, "Invite all eligible").
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientContactsList from './ClientContactsList';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  replaceDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  getContactsByClient: vi.fn(),
  getContactByContactNameId: vi.fn(),
  getAllClients: vi.fn(),
  searchContactListIds: vi.fn(),
  getCurrentUserAsync: vi.fn(),
  getContactPortalPermissions: vi.fn(),
  getPortalInvitationStatesForClient: vi.fn(),
  dialogTarget: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer: hoisted.openDrawer,
    replaceDrawer: hoisted.replaceDrawer,
    closeDrawer: hoisted.closeDrawer,
  }),
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
  getContactsByClient: hoisted.getContactsByClient,
  getContactByContactNameId: hoisted.getContactByContactNameId,
  getAllClients: hoisted.getAllClients,
  searchContactListIds: hoisted.searchContactListIds,
  getPortalInvitationStatesForClient: hoisted.getPortalInvitationStatesForClient,
}));
vi.mock('@alga-psa/auth/actions', () => ({
  getContactPortalPermissions: () => hoisted.getContactPortalPermissions(),
}));
vi.mock('../../lib/usersHelpers', () => ({ getCurrentUserAsync: hoisted.getCurrentUserAsync }));
vi.mock('./ContactDetailsEdit', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('./BulkPortalInvitationDialog', () => ({
  default: ({ target }: any) => {
    hoisted.dialogTarget(target);
    return <div data-testid="bulk-invite-dialog">{JSON.stringify(target)}</div>;
  },
}));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByEntity: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ indeterminate: _indeterminate, ...props }: any) => <input type="checkbox" {...props} />,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} aria-label={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {(options ?? []).map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      <div data-testid="table-header">
        {columns.map((column: any, index: number) => (
          <span key={index}>{typeof column.title === 'string' ? null : column.title}</span>
        ))}
      </div>
      {data.map((row: any) => (
        <div key={row.contact_name_id} data-testid={`row-${row.contact_name_id}`}>
          {columns.map((column: any, index: number) => (
            <div key={index}>{column.render ? column.render(row[column.dataIndex], row, 0) : null}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Trigger: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children, onSelect }: any) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
}));

const client: any = { client_id: 'acme', client_name: 'Acme', is_inactive: false, location_country_code: 'US' };

const contact = (id: string, name: string, email: string | null): any => ({
  contact_name_id: id,
  full_name: name,
  email,
  client_id: 'acme',
  phone_numbers: [],
  locations: [],
  primaryLocation: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getContactsByClient.mockResolvedValue([
    contact('contact-a', 'Ada Lovelace', 'ada@acme.com'),
    contact('contact-b', 'Bo Peep', 'bo@acme.com'),
  ]);
  hoisted.getAllClients.mockResolvedValue([client]);
  hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
  hoisted.getContactPortalPermissions.mockResolvedValue({ canInvite: true, canUpdateRoles: true, canRead: true });
  hoisted.getPortalInvitationStatesForClient.mockResolvedValue([
    { contactId: 'contact-a', state: 'expired', expiresAt: null },
    { contactId: 'contact-b', state: 'pending', expiresAt: '2099-01-02T00:00:00.000Z' },
  ]);
});

describe('ClientContactsList bulk portal invitations', () => {
  it('invites the ticked contacts and nothing else', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');

    expect(screen.queryByText('Invite to portal (1)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select Ada Lovelace'));
    fireEvent.click(await screen.findByText('Invite to portal (1)'));

    await waitFor(() => expect(screen.getByTestId('bulk-invite-dialog')).toBeInTheDocument());
    expect(hoisted.dialogTarget).toHaveBeenLastCalledWith({ mode: 'selected', contactIds: ['contact-a'] });
  });

  it('select-all covers the filtered set, not the whole client', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');

    fireEvent.change(screen.getByPlaceholderText('Search contacts...'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.queryByTestId('row-contact-b')).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Select all contacts'));
    fireEvent.click(await screen.findByText('Invite to portal (1)'));

    expect(hoisted.dialogTarget).toHaveBeenLastCalledWith({ mode: 'selected', contactIds: ['contact-a'] });
  });

  it('offers an all-eligible invitation without any selection', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');

    fireEvent.click(screen.getByText('Invite all eligible'));

    await waitFor(() => expect(screen.getByTestId('bulk-invite-dialog')).toBeInTheDocument());
    expect(hoisted.dialogTarget).toHaveBeenLastCalledWith({ mode: 'allEligible' });
  });

  it('shows each contact\'s invitation state on the row', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');

    expect(await screen.findByText('Invitation expired')).toBeInTheDocument();
    expect(screen.getByText(/^Pending until /)).toBeInTheDocument();
  });

  it('filters to the contacts that need chasing and resends to exactly those', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');
    await screen.findByText('Invitation expired');

    fireEvent.change(screen.getByLabelText('contact-invitation-state-filter'), {
      target: { value: 'expired' },
    });
    await waitFor(() => expect(screen.queryByTestId('row-contact-b')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('Resend expired'));

    // The filter and the batch are the same rule, so the dialog is aimed at the
    // state the MSP just narrowed to.
    expect(hoisted.dialogTarget).toHaveBeenLastCalledWith({
      mode: 'invitationState',
      states: ['expired'],
    });
  });

  it('names the pending set when the filter asks for it', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');
    await screen.findByText('Invitation expired');

    fireEvent.change(screen.getByLabelText('contact-invitation-state-filter'), {
      target: { value: 'open' },
    });
    fireEvent.click(await screen.findByText('Resend expired or pending'));

    expect(hoisted.dialogTarget).toHaveBeenLastCalledWith({
      mode: 'invitationState',
      states: ['expired', 'pending'],
    });
  });

  it('shows no invitation affordance to a reader without user:invite', async () => {
    hoisted.getContactPortalPermissions.mockResolvedValue({ canInvite: false, canUpdateRoles: false, canRead: true });

    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-a');

    await waitFor(() => expect(hoisted.getContactPortalPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Invite all eligible')).not.toBeInTheDocument();
    expect(screen.queryByText('Resend expired')).not.toBeInTheDocument();
    // No checkbox either: a selection with nothing to do with it is a dead end.
    expect(screen.queryByLabelText('Select all contacts')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Ada Lovelace')).not.toBeInTheDocument();
  });
});

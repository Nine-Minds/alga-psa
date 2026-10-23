/**
 * @vitest-environment jsdom
 *
 * Regression for alga0002338: editing a contact from a client's Contacts tab
 * must offer every client in the tenant, not just the client being viewed.
 *
 * The drawers no longer load or thread a client list at all: ContactDetailsEdit's picker
 * searches the whole tenant on the server, so the guarantee holds by construction. These
 * tests pin that no full-list call happens and no page-scoped list is passed down.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientContactsList from './ClientContactsList';
import ContactDetailsEdit from './ContactDetailsEdit';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  replaceDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  getContactsByClient: vi.fn(),
  getContactByContactNameId: vi.fn(),
  getAllClients: vi.fn(),
  searchContactListIds: vi.fn(),
  getCurrentUserAsync: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer: hoisted.openDrawer,
    replaceDrawer: hoisted.replaceDrawer,
    closeDrawer: hoisted.closeDrawer,
  }),
}));

// `t` must be referentially stable: the component lists it as an effect dependency.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/clients/actions', () => ({
  getContactsByClient: hoisted.getContactsByClient,
  getContactByContactNameId: hoisted.getContactByContactNameId,
  getAllClients: hoisted.getAllClients,
  searchContactListIds: hoisted.searchContactListIds,
}));

vi.mock('../../lib/usersHelpers', () => ({
  getCurrentUserAsync: hoisted.getCurrentUserAsync,
}));

// The drawer contents are inspected as elements; they never need to render here.
vi.mock('./ContactDetailsEdit', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByEntity: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      {data.map((row: any) => (
        <div key={row.id} data-testid={`row-${row.contact_name_id}`}>
          {columns.map((column: any, index: number) => (
            <div key={index}>{column.render ? column.render(row[column.dataIndex], row, 0) : null}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
// Radix dropdown portals are noise here; render the menu items inline.
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Trigger: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children, onSelect }: any) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
}));

const triage: any = { client_id: 'triage-id', client_name: 'Unmatched Email', is_inactive: false, location_country_code: 'US' };

const brian: any = {
  contact_name_id: 'contact-1',
  full_name: 'Brian Linscott',
  email: 'brian@example.com',
  client_id: 'triage-id',
  phone_numbers: [],
};

const lastReplacedElement = () => {
  const calls = hoisted.replaceDrawer.mock.calls;
  return calls[calls.length - 1]?.[0] as React.ReactElement<any> | undefined;
};

const renderList = () => render(<ClientContactsList clientId="triage-id" client={triage} />);

describe('ClientContactsList client options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getContactsByClient.mockResolvedValue([brian]);
    hoisted.getContactByContactNameId.mockResolvedValue(brian);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
  });

  it('row Edit opens ContactDetailsEdit without loading or threading any client list', async () => {
    renderList();
    await screen.findByTestId('row-contact-1');

    fireEvent.click(screen.getByText('Edit'));

    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.openDrawer).toHaveBeenCalledTimes(1);
    expect(hoisted.getAllClients).not.toHaveBeenCalled();
    expect(hoisted.getContactByContactNameId).toHaveBeenCalledWith('contact-1');

    const element = lastReplacedElement()!;
    expect(element.type).toBe(ContactDetailsEdit);
    expect(element.props.clients).toBeUndefined();
    expect(element.props.initialContact).toBe(brian);
  });

  it('Quick View loads no client list for the quick-view element', async () => {
    renderList();
    await screen.findByTestId('row-contact-1');

    fireEvent.click(screen.getByText('Quick View'));

    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.getAllClients).not.toHaveBeenCalled();
    const element = lastReplacedElement()!;
    expect(element.props.clients).toBeUndefined();
    expect(element.props.contact).toBe(brian);
    expect(element.props.userId).toBe('user-1');
  });

  it('clicking the contact name goes through the same quick-view path', async () => {
    renderList();
    await screen.findByTestId('row-contact-1');

    fireEvent.click(screen.getByText('Brian Linscott'));

    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.getAllClients).not.toHaveBeenCalled();
    expect(lastReplacedElement()!.props.clients).toBeUndefined();
  });

  it('shows "Contact not found." when the contact no longer exists', async () => {
    hoisted.getContactByContactNameId.mockResolvedValue(null);
    renderList();
    await screen.findByTestId('row-contact-1');

    fireEvent.click(screen.getByText('Edit'));

    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));
    const element = lastReplacedElement()!;
    expect(element.type).not.toBe(ContactDetailsEdit);
    const { container } = render(<>{element}</>);
    expect(container).toHaveTextContent('Contact not found.');
  });

  it('re-queries the client contacts after the edit drawer saves', async () => {
    renderList();
    await screen.findByTestId('row-contact-1');
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.getContactsByClient).toHaveBeenCalledTimes(1);

    hoisted.getContactsByClient.mockResolvedValue([]);
    lastReplacedElement()!.props.onSave({ ...brian, client_id: 'life-id' });

    await waitFor(() => expect(hoisted.getContactsByClient).toHaveBeenCalledTimes(2));
    expect(hoisted.getContactsByClient).toHaveBeenLastCalledWith('triage-id', 'active');
    expect(hoisted.closeDrawer).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('row-contact-1')).not.toBeInTheDocument());
  });

  it('re-queries the client contacts after the quick view reports saved changes', async () => {
    renderList();
    await screen.findByTestId('row-contact-1');
    fireEvent.click(screen.getByText('Quick View'));
    await waitFor(() => expect(hoisted.replaceDrawer).toHaveBeenCalledTimes(1));

    lastReplacedElement()!.props.onChangesSaved();

    await waitFor(() => expect(hoisted.getContactsByClient).toHaveBeenCalledTimes(2));
  });
});

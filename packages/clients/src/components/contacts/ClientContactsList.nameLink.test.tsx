/**
 * @vitest-environment jsdom
 *
 * alga-2026-0003343: a contact name on a client's Contacts tab must be a real
 * link. A plain click still opens Quick View (so the client context survives),
 * but Ctrl/Cmd+Click and middle-click belong to the browser so an MSP can fan
 * several contacts out into tabs while checking portal access.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getContactsByClient: vi.fn(),
  getContactByContactNameId: vi.fn(),
  getAllClients: vi.fn(),
  searchContactListIds: vi.fn(),
  getCurrentUserAsync: vi.fn(),
  openContactQuickView: vi.fn(),
  openContactEdit: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

// `t` must be referentially stable: the component lists it as an effect dependency.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return {
    useTranslation: () => ({ t }),
    useFormatters: () => ({
      formatDate: (value: string | Date) => new Date(value).toISOString().slice(0, 10),
    }),
  };
});

vi.mock('@alga-psa/clients/actions', () => ({
  getContactsByClient: hoisted.getContactsByClient,
  getContactByContactNameId: hoisted.getContactByContactNameId,
  getAllClients: hoisted.getAllClients,
  searchContactListIds: hoisted.searchContactListIds,
  getPortalInvitationStatesForClient: async () => [],
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getContactPortalPermissions: async () => ({ canInvite: false, canUpdateRoles: false, canRead: true }),
}));
vi.mock('../../lib/usersHelpers', () => ({ getCurrentUserAsync: hoisted.getCurrentUserAsync }));

vi.mock('./bento/useContactQuickViewDrawer', () => ({
  useContactQuickViewDrawer: () => hoisted.openContactQuickView,
}));
vi.mock('./bento/useContactEditDrawer', () => ({
  useContactEditDrawer: () => hoisted.openContactEdit,
}));

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
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
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
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _prefetch, children, ...rest }: any) =>
    React.createElement('a', { href, ...rest }, children),
}));

import ClientContactsList from './ClientContactsList';

const emerald: any = {
  client_id: 'emerald-id',
  client_name: 'Emerald City',
  is_inactive: false,
  location_country_code: 'US',
};

const dorothy: any = {
  contact_name_id: 'contact-dorothy',
  full_name: 'Dorothy Gale',
  email: 'dorothy@emeraldcity.oz',
  role: 'Owner',
  client_id: 'emerald-id',
  phone_numbers: [],
};

const renderList = () => render(<ClientContactsList clientId="emerald-id" client={emerald} />);

const findNameLink = async () => {
  await screen.findByTestId('row-contact-dorothy');
  return screen.getByRole('link', { name: 'Dorothy Gale' });
};

describe('ClientContactsList contact name link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getContactsByClient.mockResolvedValue([dorothy]);
    hoisted.getAllClients.mockResolvedValue([emerald]);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
    hoisted.searchContactListIds.mockResolvedValue([]);
  });

  it('renders the name as an anchor to the contact page', async () => {
    renderList();
    const link = await findNameLink();

    expect(link).toHaveAttribute('href', '/msp/contacts/contact-dorothy');
  });

  it('opens Quick View on a plain click instead of navigating', async () => {
    renderList();
    const link = await findNameLink();

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(hoisted.openContactQuickView).toHaveBeenCalledWith(
      'contact-dorothy',
      expect.objectContaining({ onChangesSaved: expect.any(Function) }),
    );
  });

  it.each([
    ['Ctrl+Click', { button: 0, ctrlKey: true }],
    ['Cmd+Click', { button: 0, metaKey: true }],
    ['Shift+Click', { button: 0, shiftKey: true }],
    ['middle click', { button: 1 }],
  ])('leaves %s to the browser', async (_name, init) => {
    renderList();
    const link = await findNameLink();

    const event = createEvent.click(link, init);
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(false);
    expect(hoisted.openContactQuickView).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 *
 * alga-2026-0003343: the contact name in MSP → Contacts must be a real link to
 * the contact page, so Ctrl/Cmd+Click, middle-click and "Open link in new tab"
 * work the way they do for ticket titles and client names.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContact } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  getAllContacts: vi.fn(),
  getAllClients: vi.fn(),
  getCurrentUserAsync: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: hoisted.getAllContacts,
  getContactsByClient: vi.fn(async () => []),
  getAllClients: hoisted.getAllClients,
  searchContactListIds: vi.fn(async () => []),
  exportContactsToCSV: vi.fn(),
  deleteContact: vi.fn(),
  updateContact: vi.fn(),
  getContactLastUsagePhoneTypes: vi.fn(),
  deleteOrphanedPhoneTypes: vi.fn(),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityIds: vi.fn(async () => []),
  findAllTagsByType: vi.fn(async () => []),
  isTagActionError: () => false,
}));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/tags/hooks', () => ({ useTagPermissions: () => undefined }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }),
  useClientDrawer: () => ({ openClientDrawer: vi.fn() }),
  getUniqueTagTexts: () => [],
  DeleteEntityDialog: () => null,
  handleError: vi.fn(),
}));
vi.mock('@alga-psa/ui/components', () => ({ TagFilter: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Trigger: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({
  usePrintAction: () => ({ triggerPrint: vi.fn(), isPreparing: false }),
}));
vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({
  PrintOptionsDialog: () => null,
  usePrintColumnSelection: () => ({
    selectedColumns: [],
    selectedColumnKeys: [],
    setSelectedColumnKeys: vi.fn(),
    resetSelectedColumnKeys: vi.fn(),
  }),
}));
vi.mock('@alga-psa/ui/components/PrintableTable', () => ({ PrintableTable: () => null }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({
  default: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  ShortcutActiveRegion: ({ children }: any) => <div>{children}</div>,
  usePageCreateShortcut: () => undefined,
}));
// Renders each row's Name cell through the page's own column renderer.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => {
    const nameColumn = columns.find((column: any) => column.dataIndex === 'full_name');
    return (
      <div>
        {data.map((row: any) => (
          <div key={row.contact_name_id} data-testid={`row-${row.contact_name_id}`}>
            {nameColumn.render(row.full_name, row)}
          </div>
        ))}
      </div>
    );
  },
}));
vi.mock('@alga-psa/list-views/hooks', () => ({ useListViews: () => ({}) }));
vi.mock('@alga-psa/list-views/components', () => ({ ListViewPicker: () => null }));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => ({ value: 10, setValue: vi.fn() }),
}));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByEntity: vi.fn() }),
}));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _prefetch, children, ...rest }: any) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, toast };
});

vi.mock('../../lib/usersHelpers', () => ({ getCurrentUserAsync: hoisted.getCurrentUserAsync }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('../clients/ClientQuickView', () => ({ default: () => null }));
vi.mock('./EntraContactBadge', () => ({ EntraContactBadge: () => null }));
vi.mock('./ContactsSkeleton', () => ({ default: () => <div data-testid="contacts-skeleton" /> }));
vi.mock('./ContactsImportDialog', () => ({ default: () => null }));

import Contacts from './Contacts';

const dorothy = {
  contact_name_id: 'contact-dorothy',
  full_name: 'Dorothy Gale',
  email: 'dorothy@emeraldcity.oz',
  client_id: 'emerald-id',
  client_name: 'Emerald City',
  is_inactive: false,
  phone_numbers: [],
  additional_email_addresses: [],
} as unknown as IContact;

describe('Contacts — the name cell is a real link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getAllContacts.mockResolvedValue([dorothy]);
    hoisted.getAllClients.mockResolvedValue([]);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
  });

  it('links the name to the contact page', async () => {
    render(<Contacts initialContacts={[dorothy]} />);
    await screen.findByTestId('row-contact-dorothy');

    expect(screen.getByRole('link', { name: 'Dorothy Gale' }))
      .toHaveAttribute('href', '/msp/contacts/contact-dorothy');
  });
});

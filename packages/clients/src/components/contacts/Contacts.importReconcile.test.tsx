/**
 * @vitest-environment jsdom
 *
 * A CSV import returns both the contacts it created and the ones it updated.
 * The list must fold them in by id: an updated contact replaces its row (no
 * duplicate until reload) and only contacts with new ids are appended. The
 * import returns bare contact rows, so the row must keep the list-only fields
 * the import does not carry (avatar) and stay searchable by client name.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContact } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  getAllContacts: vi.fn(),
  getAllClients: vi.fn(),
  getCurrentUserAsync: vi.fn(),
  importedContacts: [] as any[],
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
vi.mock('@alga-psa/ui/components/SearchInput', () => ({
  SearchInput: ({ id, value, onChange }: any) => (
    <input data-testid={id} value={value} onChange={onChange} />
  ),
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  ShortcutActiveRegion: ({ children }: any) => <div>{children}</div>,
  usePageCreateShortcut: () => undefined,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data }: any) => (
    <div>
      {data.map((row: any) => (
        <div
          key={row.id}
          data-testid={`row-${row.contact_name_id}`}
          data-avatar={row.avatarUrl ?? ''}
          data-client-name={row.client_name ?? ''}
        >
          {row.full_name}
        </div>
      ))}
    </div>
  ),
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock('../../lib/usersHelpers', () => ({ getCurrentUserAsync: hoisted.getCurrentUserAsync }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('../clients/ClientQuickView', () => ({ default: () => null }));
vi.mock('./EntraContactBadge', () => ({ EntraContactBadge: () => null }));
vi.mock('./ContactsSkeleton', () => ({ default: () => <div data-testid="contacts-skeleton" /> }));
// The import dialog's contract with the list is `onImportComplete(contacts)`.
vi.mock('./ContactsImportDialog', () => ({
  default: ({ onImportComplete }: any) => (
    <button type="button" onClick={() => onImportComplete(hoisted.importedContacts)}>
      finish-import
    </button>
  ),
}));

import Contacts from './Contacts';

function contact(id: string, fullName: string, extra: Partial<IContact> = {}): IContact {
  return {
    contact_name_id: id,
    full_name: fullName,
    email: `${id}@example.com`,
    client_id: null,
    is_inactive: false,
    phone_numbers: [],
    additional_email_addresses: [],
    ...extra,
  } as unknown as IContact;
}

describe('Contacts — CSV import reconciliation', () => {
  const ada = contact('ada', 'Ada Lovelace');
  const grace = contact('grace', 'Grace Hopper');

  beforeEach(() => {
    hoisted.getAllContacts.mockResolvedValue([ada, grace]);
    hoisted.getAllClients.mockResolvedValue([
      { client_id: 'client-acme', client_name: 'Acme Corp' },
      { client_id: 'client-globex', client_name: 'Globex' },
    ]);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
  });

  it('replaces an updated contact in place and appends only new ids', async () => {
    render(<Contacts initialContacts={[ada, grace]} />);
    await waitFor(() => expect(screen.getByTestId('row-grace')).toBeInTheDocument());

    hoisted.importedContacts = [
      contact('ada', 'Ada King, Countess of Lovelace'),
      contact('linus', 'Linus Torvalds'),
    ];
    await act(async () => {
      fireEvent.click(screen.getByText('finish-import'));
    });

    expect(screen.getAllByTestId('row-ada')).toHaveLength(1);
    expect(screen.getByTestId('row-ada')).toHaveTextContent('Ada King, Countess of Lovelace');
    expect(screen.getAllByTestId('row-grace')).toHaveLength(1);
    expect(screen.getAllByTestId('row-linus')).toHaveLength(1);
    expect(
      screen.getAllByTestId(/^row-/).map((row) => row.getAttribute('data-testid')),
    ).toEqual(['row-ada', 'row-grace', 'row-linus']);
  });

  it('keeps list-only fields the import does not return and re-derives the client name', async () => {
    // As getAllContacts returns them: with avatarUrl and the joined client_name.
    const listedAda = contact('ada', 'Ada Lovelace', {
      client_id: 'client-acme',
      client_name: 'Acme Corp',
      avatarUrl: '/avatars/ada.png',
    });
    const listedGrace = contact('grace', 'Grace Hopper', {
      client_id: 'client-acme',
      client_name: 'Acme Corp',
      avatarUrl: '/avatars/grace.png',
    });
    hoisted.getAllContacts.mockResolvedValue([listedAda, listedGrace]);
    render(<Contacts initialContacts={[listedAda, listedGrace]} />);
    await waitFor(() => expect(screen.getByTestId('row-grace')).toBeInTheDocument());

    // As importContactsFromCSV returns them (getContactById): no avatarUrl, no
    // client_name. Ada is edited in place, Grace moves to another client.
    hoisted.importedContacts = [
      contact('ada', 'Ada King', { client_id: 'client-acme' }),
      contact('grace', 'Grace Hopper', { client_id: 'client-globex' }),
      contact('linus', 'Linus Torvalds', { client_id: 'client-globex' }),
    ];
    await act(async () => {
      fireEvent.click(screen.getByText('finish-import'));
    });

    expect(screen.getByTestId('row-ada')).toHaveTextContent('Ada King');
    expect(screen.getByTestId('row-ada')).toHaveAttribute('data-avatar', '/avatars/ada.png');
    expect(screen.getByTestId('row-ada')).toHaveAttribute('data-client-name', 'Acme Corp');
    expect(screen.getByTestId('row-grace')).toHaveAttribute('data-avatar', '/avatars/grace.png');
    expect(screen.getByTestId('row-grace')).toHaveAttribute('data-client-name', 'Globex');
    expect(screen.getByTestId('row-linus')).toHaveAttribute('data-client-name', 'Globex');

    // Client-name search still finds the edited contact without a refetch.
    fireEvent.change(screen.getByTestId('filter-contacts'), { target: { value: 'acme' } });
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^row-/).map((row) => row.getAttribute('data-testid')),
      ).toEqual(['row-ada']),
    );
  });
});

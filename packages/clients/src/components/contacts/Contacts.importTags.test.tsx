/**
 * @vitest-environment jsdom
 *
 * After a CSV import resolves, the contacts list re-reads tags for the
 * imported contacts and the row's (real) TagManager shows the new state at
 * once: a blank Tags cell leaves the chip in place (the server keeps the tags),
 * and a replacement tag shows instead of the old one. The updated contact stays listed once.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContact } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  getAllContacts: vi.fn(),
  getAllClients: vi.fn(),
  getCurrentUserAsync: vi.fn(),
  importedContacts: [] as any[],
  // Tag mappings as the server currently has them, by contact id.
  serverTags: {} as Record<string, any[]>,
  findTagsByEntityIds: vi.fn(),
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
  findTagsByEntityIds: hoisted.findTagsByEntityIds,
  findAllTagsByType: vi.fn(async () => []),
  isTagActionError: () => false,
  // Used by the real TagManager; not exercised here.
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getAllTags: vi.fn(async () => []),
  getTagMappingUsageCount: vi.fn(),
}));
vi.mock('@alga-psa/tags/context/TagContext', () => ({ useTags: () => null }));
vi.mock('@alga-psa/ui/components/tags', () => ({
  TagList: ({ tags }: any) => (
    <>
      {tags.map((tag: any) => (
        <span key={tag.tag_id} data-testid="tag-chip">{tag.tag_text}</span>
      ))}
    </>
  ),
  TagInput: () => null,
  TagInputInline: () => null,
}));
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
// Renders each row's Tags cell through the page's own column renderer.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => {
    const tagsColumn = columns.find((column: any) => column.dataIndex === 'tags');
    return (
      <div>
        {data.map((row: any) => (
          <div key={row.id} data-testid={`row-${row.contact_name_id}`}>
            {row.full_name}
            <div data-testid={`tags-${row.contact_name_id}`}>{tagsColumn.render(row.tags, row)}</div>
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
// The import dialog's contract with the list is `onImportComplete(contacts)`.
vi.mock('./ContactsImportDialog', () => ({
  default: ({ onImportComplete }: any) => (
    <button type="button" onClick={() => onImportComplete(hoisted.importedContacts)}>
      finish-import
    </button>
  ),
}));

import Contacts from './Contacts';

function contact(id: string, fullName: string): IContact {
  return {
    contact_name_id: id,
    full_name: fullName,
    email: `${id}@example.com`,
    client_id: null,
    is_inactive: false,
    phone_numbers: [],
    additional_email_addresses: [],
  } as unknown as IContact;
}

function tag(id: string, text: string, contactId: string) {
  return { tag_id: id, tag_text: text, tagged_id: contactId, tagged_type: 'contact' };
}

const chipsFor = (contactId: string) =>
  within(screen.getByTestId(`tags-${contactId}`))
    .queryAllByTestId('tag-chip')
    .map((chip) => chip.textContent);

describe('Contacts — CSV import refreshes row tags', () => {
  const ada = contact('ada', 'Ada Lovelace');
  const grace = contact('grace', 'Grace Hopper');

  beforeEach(() => {
    hoisted.getAllContacts.mockResolvedValue([ada, grace]);
    hoisted.getAllClients.mockResolvedValue([]);
    hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
    hoisted.serverTags = { ada: [tag('tag-a', 'A', 'ada')], grace: [tag('tag-g', 'G', 'grace')] };
    hoisted.findTagsByEntityIds.mockImplementation(async (ids: string[]) =>
      ids.flatMap((id) => hoisted.serverTags[id] ?? []),
    );
  });

  async function renderWithTagA() {
    render(<Contacts initialContacts={[ada, grace]} />);
    await waitFor(() => expect(chipsFor('ada')).toEqual(['A']));
    expect(chipsFor('grace')).toEqual(['G']);
  }

  async function finishImport(updated: IContact) {
    hoisted.importedContacts = [updated];
    await act(async () => {
      fireEvent.click(screen.getByText('finish-import'));
    });
  }

  it('leaves the chip in place when the import mapped Tags but left the cell blank', async () => {
    await renderWithTagA();

    // A blank cell writes nothing, so the server still holds tag A.
    await finishImport(contact('ada', 'Ada Lovelace'));

    await waitFor(() => expect(chipsFor('ada')).toEqual(['A']));
    expect(chipsFor('grace')).toEqual(['G']);
    expect(screen.getAllByTestId('row-ada')).toHaveLength(1);
  });

  it('shows the replacement tag, not the old one, after the import', async () => {
    await renderWithTagA();

    hoisted.serverTags = { ...hoisted.serverTags, ada: [tag('tag-b', 'B', 'ada')] };
    await finishImport(contact('ada', 'Ada Lovelace'));

    await waitFor(() => expect(chipsFor('ada')).toEqual(['B']));
    expect(chipsFor('grace')).toEqual(['G']);
    expect(screen.getAllByTestId('row-ada')).toHaveLength(1);
  });
});

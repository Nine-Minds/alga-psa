/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddTicket } from '../QuickAddTicket';

const addTicketMock = vi.fn();
const updateTicketMock = vi.fn();
const uploadDocumentMock = vi.fn();
const getTicketFormDataMock = vi.fn();
const getTicketStatusesMock = vi.fn();
const getContactsByClientMock = vi.fn();
const getClientLocationsMock = vi.fn();
const getTicketDuplicateSourceMock = vi.fn();
const clientSelectSpy = vi.fn();
const boardSelectSpy = vi.fn();
const pushMock = vi.fn();

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock
  })
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: (...args: unknown[]) => addTicketMock(...args),
  updateTicket: (...args: unknown[]) => updateTicketMock(...args),
  getTicketDuplicateSource: (...args: unknown[]) => getTicketDuplicateSourceMock(...args),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn()
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args)
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: (...args: unknown[]) => getContactsByClientMock(...args),
  getClientLocations: (...args: unknown[]) => getClientLocationsMock(...args)
}));

// Lightweight non-modal Dialog: the real radix-based Dialog aria-hides sibling
// content (the QuickAddContact/QuickAddClient mocks render as siblings), which
// breaks role-based queries that work against the real portalled dialogs.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div role="dialog" data-testid="quick-add-dialog-root">
        {title ? <h2>{title}</h2> : null}
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: function ClientPickerMock({ onSelect, selectedClientId, clients, disabled }: any) {
    return (
      <div data-testid="client-picker">
        <div data-testid="client-picker-value">{selectedClientId}</div>
        <div data-testid="client-picker-disabled">{String(Boolean(disabled))}</div>
        <button
          type="button"
          onClick={() => {
            clientSelectSpy();
            onSelect('client-2');
          }}
        >
          Change client
        </button>
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ onAddNew, value, contacts }: any) => (
    <div data-testid="contact-picker">
      <div data-testid="contact-picker-value">{value}</div>
      <div data-testid="contact-picker-count">{contacts.length}</div>
      {onAddNew ? (
        <button type="button" onClick={onAddNew}>
          + Add new contact
        </button>
      ) : null}
    </div>
  )
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: ({ onAddNew, categories, selectedCategories }: any) => (
    <div data-testid="category-picker">
      <div data-testid="category-picker-value">{selectedCategories?.[0] || ''}</div>
      <div data-testid="category-picker-count">{categories.length}</div>
      {onAddNew ? (
        <button type="button" onClick={onAddNew}>
          + Add new category
        </button>
      ) : null}
    </div>
  )
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: ({ isOpen, preselectedBoardId, onCategoryCreated }: any) => {
    if (!isOpen) {
      return null;
    }

    return (
      <div data-testid="quick-add-category-dialog">
        <div data-testid="quick-add-category-board">{preselectedBoardId}</div>
        <button
          type="button"
          onClick={() => onCategoryCreated({
            category_id: 'category-new',
            category_name: 'Networking',
            board_id: preselectedBoardId,
            parent_category: null,
          })}
        >
          Create Category
        </button>
      </div>
    );
  },
}));

vi.mock('@alga-psa/clients/components', () => ({
    __esModule: true,
    QuickAddContact: ({ isOpen, selectedClientId, onContactAdded }: any) => {
      if (!isOpen) {
        return null;
      }

      return (
        <div data-testid="quick-add-contact-dialog">
          <div data-testid="quick-add-contact-client">{selectedClientId}</div>
          <button
            type="button"
            onClick={() => onContactAdded({
              contact_name_id: 'contact-new',
              full_name: 'Grace Hopper',
              email: 'grace@example.com',
              client_id: selectedClientId,
              is_inactive: false,
            })}
          >
            Create Contact
          </button>
        </div>
      );
    },
    QuickAddClient: ({ open, onClientAdded, onOpenChange }: any) => {
      if (!open) {
        return null;
      }

      return (
        <div data-testid="quick-add-client-dialog">
          <button
            type="button"
            onClick={() => {
              onClientAdded({
                client_id: 'client-new',
                client_name: 'New Client',
                client_type: 'company',
                is_inactive: false,
              });
              onOpenChange(false);
            }}
          >
            Create Client
          </button>
        </div>
      );
    },
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({
    renderQuickAddContact: ({ isOpen, selectedClientId, onContactAdded }: any) => {
      if (!isOpen) {
        return null;
      }

      return (
        <div data-testid="quick-add-contact-dialog">
          <div data-testid="quick-add-contact-client">{selectedClientId}</div>
          <button
            type="button"
            onClick={() => onContactAdded({
              contact_name_id: 'contact-new',
              full_name: 'Grace Hopper',
              email: 'grace@example.com',
              client_id: selectedClientId,
              is_inactive: false,
            })}
          >
            Create Contact
          </button>
        </div>
      );
    },
    renderQuickAddClient: ({ open, onClientAdded, onOpenChange }: any) => {
      if (!open) {
        return null;
      }

      return (
        <div data-testid="quick-add-client-dialog">
          <button
            type="button"
            onClick={() => {
              onClientAdded({
                client_id: 'client-new',
                client_name: 'New Client',
                client_type: 'company',
                is_inactive: false,
              });
              onOpenChange(false);
            }}
          >
            Create Client
          </button>
        </div>
      );
    },
  }),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

// QuickAddTicket now renders UserAndTeamPicker/MultiUserAndTeamPicker for assignment.
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ value }: any) => <div data-testid="assigned-to-value">{value}</div>,
}));

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ values }: any) => <div data-testid="additional-agents-value">{(values || []).join(',')}</div>,
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ onSelect, selectedBoardId }: any) => (
    <div data-testid="board-picker">
      <div data-testid="board-picker-value">{selectedBoardId}</div>
      <button type="button" onClick={() => { boardSelectSpy(); onSelect('board-1'); }}>Change board</button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ onValueChange, options, value, id }: any) => (
    <select
      data-testid={`select-${id ?? 'anon'}`}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  )
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
  getTicketCategories: vi.fn(),
  getAllBoards: vi.fn()
}));

vi.mock('../../actions/ticketCategoryActions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
  getTicketCategories: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
  getAllPriorities: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/searchUsersForMentions', () => ({
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  uploadDocument: (...args: unknown[]) => uploadDocumentMock(...args)
}));

vi.mock('@alga-psa/ui/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  const paragraphBlock = (text: string) => [{
    type: 'paragraph',
    props: {
      textAlignment: 'left',
      backgroundColor: 'default',
      textColor: 'default',
    },
    content: [{
      type: 'text',
      text,
      styles: {},
    }],
  }];

  const withImageBlock = (text: string, imageUrl?: string) => {
    const blocks: any[] = paragraphBlock(text);
    if (imageUrl) {
      blocks.push({
        type: 'image',
        props: {
          url: imageUrl,
          name: 'clipboard-image.png',
          caption: '',
        },
      });
    }
    return blocks;
  };

  return {
    TextEditor: ({ id, initialContent, onContentChange, uploadFile, placeholder }: any) => {
      const [text, setText] = React.useState(() => {
        if (Array.isArray(initialContent) && Array.isArray(initialContent[0]?.content)) {
          return initialContent[0].content.map((item: any) => item?.text || '').join('');
        }
        return '';
      });

      return (
        <div>
          <textarea
            aria-label={placeholder || 'Description'}
            data-testid={`${id}-mock-editor`}
            value={text}
            onChange={(event) => {
              const nextText = event.target.value;
              setText(nextText);
              onContentChange?.(paragraphBlock(nextText));
            }}
          />
          <button
            type="button"
            onClick={async () => {
              const imageUrl = await uploadFile?.(
                new File(['image-bytes'], 'clipboard-image.png', { type: 'image/png' })
              );
              onContentChange?.(withImageBlock(text, imageUrl));
            }}
          >
            Paste Image
          </button>
        </div>
      );
    },
    RichTextViewer: () => null,
  };
});

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, onClose, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }: any) => {
    if (!isOpen) {
      return null;
    }

    return (
      <div data-testid="confirmation-dialog">
        <button type="button" onClick={onClose}>{cancelLabel}</button>
        <button type="button" onClick={() => onConfirm()}>{confirmLabel}</button>
      </div>
    );
  }
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: ({ pendingTags }: any) => (
    <div data-testid="tag-picker">{JSON.stringify(pendingTags)}</div>
  ),
}));

vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({
  QuickAddTagPicker: ({ pendingTags }: any) => (
    <div data-testid="tag-picker">{JSON.stringify(pendingTags)}</div>
  ),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntity: vi.fn()
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntity: vi.fn()
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn()
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActionErrors', () => ({
  isTeamActionError: () => false,
}));

vi.mock('../../actions/teamAssignmentActions', () => ({
  assignTeamToTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false })
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      // Mirror i18next's t(key, options) form where options carries defaultValue.
      if (fallback && typeof fallback === 'object') {
        options = fallback;
        fallback = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : undefined;
      }

      if (!fallback) {
        return _key;
      }

      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
    },
  }),
}));

vi.mock('../useQuickAddRichTextUploadSession', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    useQuickAddRichTextUploadSession: ({ onDiscard }: { onDiscard?: () => void }) => {
      const [stagedClipboardImages, setStagedClipboardImages] = React.useState<
        Array<{ file: File; url: string }>
      >([]);
      const [showDraftCancelDialog, setShowDraftCancelDialog] = React.useState(false);

      return {
        stagedClipboardImages,
        uploadFile: async (file: File) => {
          const url = `blob:${file.name}`;
          setStagedClipboardImages((current) => [...current, { file, url }]);
          return url;
        },
        requestDiscard: () => {
          if (stagedClipboardImages.length > 0) {
            setShowDraftCancelDialog(true);
            return;
          }
          onDiscard?.();
        },
        resetDraftTracking: () => {
          setStagedClipboardImages([]);
          setShowDraftCancelDialog(false);
        },
        showDraftCancelDialog,
        setShowDraftCancelDialog,
        deleteTrackedDraftClipboardImages: async () => {
          setStagedClipboardImages([]);
          setShowDraftCancelDialog(false);
          onDiscard?.();
        },
        keepDraftClipboardImages: () => {
          setShowDraftCancelDialog(false);
        },
        isDeletingDraftImages: false,
      };
    },
  };
});

vi.mock('../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: (value: string) => {
    if (!value) {
      return [];
    }

    try {
      return JSON.parse(value);
    } catch {
      return [
        {
          type: 'paragraph',
          props: {
            textAlignment: 'left',
            backgroundColor: 'default',
            textColor: 'default',
          },
          content: [
            {
              type: 'text',
              text: value,
              styles: {},
            },
          ],
        },
      ];
    }
  },
  serializeTicketRichTextContent: (content: unknown) => JSON.stringify(content ?? []),
}));

vi.mock('../../lib/ticketRichTextImages', () => ({
  removeTicketRichTextImageUrls: (content: any[], urlsToRemove: Set<string>) =>
    content.filter((block) => block?.type !== 'image' || !urlsToRemove.has(block?.props?.url)),
  replaceTicketRichTextImageUrls: (content: any[], replacementUrls: Map<string, string>) =>
    content.map((block) =>
      block?.type === 'image' && replacementUrls.has(block?.props?.url)
        ? {
            ...block,
            props: {
              ...block.props,
              url: replacementUrls.get(block.props.url),
            },
          }
        : block
    ),
}));

import { permissionError } from '@alga-psa/ui/lib/errorHandling';

const SOURCE_ID = '3f0c1a52-8a53-4c6e-9d0e-0d6f3b1c2a77';

const makeSource = (overrides: Record<string, unknown> = {}) => ({
  ticket_id: SOURCE_ID,
  ticket_number: 'TIC-1042',
  title: 'Onboard new employee',
  description: 'Laptop, accounts, badge',
  client: { id: 'client-1', name: 'Acme', type: 'company' },
  contact: { id: 'contact-7', name: 'Jane Doe' },
  location_id: 'loc-1',
  board_id: 'board-1',
  category_id: 'cat-1',
  subcategory_id: 'subcat-1',
  priority_id: 'priority-1',
  itil_impact: null,
  itil_urgency: null,
  assigned_to: 'user-9',
  assigned_team_id: null,
  additional_agents: [
    { user_id: 'user-2', first_name: 'Ada', last_name: 'Lovelace' },
    { user_id: 'user-3', first_name: 'Alan', last_name: 'Turing' },
  ],
  tags: [
    { tag_id: 'tag-1', tag_text: 'onboarding', background_color: '#111111', text_color: '#ffffff' },
  ],
  checklist: [
    { item_name: 'Order laptop', is_required: true },
    { item_name: 'Create accounts', is_required: false },
  ],
  custom_field_count: 2,
  ...overrides,
});

function renderDuplicate() {
  return render(
    <QuickAddTicket
      open={true}
      onOpenChange={() => undefined}
      onTicketAdded={() => undefined}
      duplicateFromTicketId={SOURCE_ID}
    />
  );
}

// "After the board/status/category/client fetches resolve": the board-driven effects run
// once boardId is set from the source, and the status effect then picks the default.
async function waitForDraftSettled() {
  await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
  await waitFor(() => expect(getTicketDuplicateSourceMock).toHaveBeenCalledWith(SOURCE_ID));
  await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-1'));
  await waitFor(() => expect(getContactsByClientMock).toHaveBeenCalled());
  await waitFor(() => expect(getClientLocationsMock).toHaveBeenCalled());
  await waitFor(() => {
    const status = screen.getByTestId('select-ticket-quick-add') as HTMLSelectElement;
    expect(status.value).toBe('status-1');
  });
}

function submittedFormData(): FormData {
  expect(addTicketMock).toHaveBeenCalledTimes(1);
  return addTicketMock.mock.calls[0][0] as FormData;
}

describe('QuickAddTicket duplicate mode', () => {
  beforeEach(() => {
    addTicketMock.mockReset();
    pushMock.mockReset();
    updateTicketMock.mockReset();
    clientSelectSpy.mockReset();
    boardSelectSpy.mockReset();
    getTicketDuplicateSourceMock.mockReset();
    getTicketDuplicateSourceMock.mockResolvedValue(makeSource());
    getContactsByClientMock.mockResolvedValue([
      { contact_name_id: 'contact-7', full_name: 'Jane Doe', email: 'jane@example.com', client_id: 'client-1', is_inactive: false },
    ]);
    getClientLocationsMock.mockResolvedValue([
      { location_id: 'loc-1', location_name: 'HQ', address_line1: '1 Main St', city: 'Springfield', is_default: true },
    ]);
    getTicketFormDataMock.mockResolvedValue({
      users: [
        { user_id: 'user-9', first_name: 'Grace', last_name: 'Hopper' },
        { user_id: 'user-2', first_name: 'Ada', last_name: 'Lovelace' },
        { user_id: 'user-3', first_name: 'Alan', last_name: 'Turing' },
      ],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      clients: [
        { client_id: 'client-1', client_name: 'Acme', client_type: 'company' },
        { client_id: 'client-2', client_name: 'Globex', client_type: 'company' },
      ],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
      // No selectedClient: duplicate mode must not lock the client.
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-2', name: 'Closed', is_default: false, is_closed: true },
      { status_id: 'status-1', name: 'Open', is_default: true, is_closed: false },
    ]);
    addTicketMock.mockResolvedValue({ ticket_id: 'ticket-copy', attributes: {} });
    updateTicketMock.mockResolvedValue({});
  });

  it('prefills the form from the source without locking the client', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Onboard new employee');
    expect(screen.getByDisplayValue('Laptop, accounts, badge')).toBeInTheDocument();

    expect(screen.getByTestId('client-picker-value')).toHaveTextContent('client-1');
    // Not locked: the client picker is enabled and can still be changed.
    expect(screen.getByTestId('client-picker-disabled')).toHaveTextContent('false');
    expect(screen.queryByTestId('client-picker-locked')).not.toBeInTheDocument();

    expect(screen.getByTestId('contact-picker-value')).toHaveTextContent('contact-7');
    expect((screen.getByTestId('select-ticket-quick-add-location') as HTMLSelectElement).value).toBe('loc-1');
    expect(screen.getByTestId('board-picker-value')).toHaveTextContent('board-1');
    // Subcategory wins over category when both are set.
    expect(screen.getByTestId('category-picker-value')).toHaveTextContent('subcat-1');
    expect((screen.getByTestId('select-ticket-quick-add-priority') as HTMLSelectElement).value).toBe('priority-1');
    expect(screen.getByTestId('assigned-to-value')).toHaveTextContent('user-9');
    expect(screen.getByTestId('additional-agents-value')).toHaveTextContent('user-2,user-3');

    const tags = JSON.parse(screen.getByTestId('tag-picker').textContent || '[]');
    expect(tags).toEqual([
      {
        tag_id: 'tag-1',
        tag_text: 'onboarding',
        background_color: '#111111',
        text_color: '#ffffff',
        isNew: false,
      },
    ]);
  });

  it('never routes through the board/client change handlers (R1)', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    // The pickers' onSelect is handleBoardChange / handleClientChange. The draft must be
    // applied by setting state directly, so neither fired and nothing was reset.
    expect(boardSelectSpy).not.toHaveBeenCalled();
    expect(clientSelectSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('select-ticket-quick-add-priority')).toHaveValue('priority-1');
    expect(screen.getByTestId('assigned-to-value')).toHaveTextContent('user-9');
    expect(screen.getByTestId('additional-agents-value')).toHaveTextContent('user-2,user-3');
    expect(screen.getByTestId('category-picker-value')).toHaveTextContent('subcat-1');
  });

  it('uses the board default status, not anything from the source, and leaves due date empty', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    const status = screen.getByTestId('select-ticket-quick-add') as HTMLSelectElement;
    expect(status.value).toBe('status-1');
    expect(screen.getByTestId('due-date')).toHaveValue('');
  });

  it('shows #N in the dialog title and the provenance pill', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    expect(screen.getByRole('heading', { name: 'Duplicate ticket #TIC-1042' })).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-ticket-duplicate-pill')).toHaveTextContent('Duplicating #TIC-1042');
  });

  it('lists the checklist and the custom-field note', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    const block = screen.getByTestId('quick-add-ticket-duplicate-checklist');
    expect(block).toHaveTextContent('Checklist from #TIC-1042');
    expect(block).toHaveTextContent('Order laptop');
    expect(block).toHaveTextContent('Create accounts');
    // Only the required item carries the marker.
    expect(block.textContent?.match(/\(required\)/g)).toHaveLength(1);
    expect(screen.getByTestId('quick-add-ticket-duplicate-custom-fields')).toHaveTextContent(
      'Custom field values are copied from #TIC-1042.'
    );
  });

  it('omits the checklist block and custom-field note when the source has none', async () => {
    getTicketDuplicateSourceMock.mockResolvedValue(makeSource({ checklist: [], custom_field_count: 0 }));
    renderDuplicate();
    await waitForDraftSettled();

    expect(screen.queryByTestId('quick-add-ticket-duplicate-checklist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-add-ticket-duplicate-custom-fields')).not.toBeInTheDocument();
  });

  it('submits duplicate_of_ticket_id with checklist copying on, and the default status', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    fireEvent.click(document.getElementById('ticket-quick-add-submit-btn') as HTMLElement);
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = submittedFormData();
    expect(formData.get('duplicate_of_ticket_id')).toBe(SOURCE_ID);
    expect(formData.get('duplicate_copy_checklist')).toBe('true');
    expect(formData.get('status_id')).toBe('status-1');
    expect(formData.get('title')).toBe('Onboard new employee');
    expect(formData.get('client_id')).toBe('client-1');
    expect(formData.get('board_id')).toBe('board-1');
    expect(formData.get('contact_name_id')).toBe('contact-7');
    expect(formData.get('location_id')).toBe('loc-1');
    expect(formData.get('priority_id')).toBe('priority-1');
    expect(formData.get('assigned_to')).toBe('user-9');
    expect(formData.has('due_date')).toBe(false);
  });

  it('sends duplicate_copy_checklist=false when the checklist is unchecked', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    const checkbox = screen.getByLabelText('Copy checklist items (unchecked)') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));

    fireEvent.click(document.getElementById('ticket-quick-add-submit-btn') as HTMLElement);
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = submittedFormData();
    expect(formData.get('duplicate_of_ticket_id')).toBe(SOURCE_ID);
    expect(formData.get('duplicate_copy_checklist')).toBe('false');
  });

  it('leaves the client editable and clears nothing else when the client is changed', async () => {
    renderDuplicate();
    await waitForDraftSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Change client' }));
    await waitFor(() => expect(screen.getByTestId('client-picker-value')).toHaveTextContent('client-2'));
    expect(clientSelectSpy).toHaveBeenCalledTimes(1);
  });

  it('is a plain create form without duplicateFromTicketId', async () => {
    render(
      <QuickAddTicket open={true} onOpenChange={() => undefined} onTicketAdded={() => undefined} />
    );
    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());

    expect(getTicketDuplicateSourceMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-add-ticket-duplicate-pill')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick Add Ticket' })).toBeInTheDocument();
  });

  it('shows a loader permission error in the Alert and keeps Create validating normally', async () => {
    getTicketDuplicateSourceMock.mockResolvedValue(
      permissionError('Permission denied: Cannot view ticket')
    );
    renderDuplicate();

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    const alert = await screen.findByTestId('quick-add-ticket-duplicate-error');
    expect(alert).toHaveTextContent('Permission denied: Cannot view ticket');

    // Nothing was prefilled and no duplicate pill is shown.
    expect(screen.queryByTestId('quick-add-ticket-duplicate-pill')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('');

    // Create still validates as usual (title/board/etc. missing) and does not call addTicket.
    fireEvent.click(document.getElementById('ticket-quick-add-submit-btn') as HTMLElement);
    await waitFor(() => expect(screen.getAllByText(/title is required/i).length).toBeGreaterThan(0));
    expect(addTicketMock).not.toHaveBeenCalled();
  });
});

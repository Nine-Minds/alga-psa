/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const getTicketTemplateForCreateMock = vi.fn();
const listTicketTemplatesForCreateMock = vi.fn();
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

vi.mock('../../actions/ticketTemplateActions', () => ({
  getTicketTemplateForCreate: (...args: unknown[]) => getTicketTemplateForCreateMock(...args),
  listTicketTemplatesForCreate: (...args: unknown[]) => listTicketTemplatesForCreateMock(...args),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn()
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args)
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: (...args: unknown[]) => getContactsByClientMock(...args),
  getClientLocations: (...args: unknown[]) => getClientLocationsMock(...args),
  searchClientsForPicker: vi.fn(),
  getClientById: vi.fn(async (id: string) => ({
    client_id: id,
    client_name: id === 'client-2' ? 'Globex' : id === 'client-1' ? 'Acme' : id,
    client_type: 'company',
  })),
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
  ClientPicker: function ClientPickerMock({ onSelect, selectedClientId, clients, searchClients, disabled }: any) {
    return (
      <div data-testid="client-picker" data-async={String(typeof searchClients === 'function' && clients === undefined)}>
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

vi.mock('../../lib/ticketRichText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ticketRichText')>()),
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


const TEMPLATE_ID = '5b1d7d4e-1c0e-4c0a-9d6a-0c1f2f7a9b10';

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  template_id: TEMPLATE_ID,
  name: 'Dept change',
  title: 'Employee department change',
  description: 'Steps for the move',
  board_id: 'board-1',
  category_id: 'cat-1',
  subcategory_id: 'subcat-1',
  priority_id: 'priority-1',
  itil_impact: null,
  itil_urgency: null,
  tags: [{ tag_id: 'tag-1', tag_text: 'onboarding', background_color: '#111111', text_color: '#ffffff', is_new: false }],
  checklist: [
    { item_name: 'Create accounts', is_required: true },
    { item_name: 'Order laptop', is_required: false },
  ],
  custom_field_count: 2,
  warnings: [],
  ...overrides,
});

const pickerId = 'select-ticket-quick-add-template-select';

function renderQuickAdd(props: Record<string, unknown> = {}) {
  return render(
    <QuickAddTicket open={true} onOpenChange={() => undefined} onTicketAdded={() => undefined} {...props} />
  );
}

async function pickTemplate() {
  const picker = (await screen.findByTestId(pickerId)) as HTMLSelectElement;
  fireEvent.change(picker, { target: { value: TEMPLATE_ID } });
}

function submittedFormData(): FormData {
  expect(addTicketMock).toHaveBeenCalledTimes(1);
  return addTicketMock.mock.calls[0][0] as FormData;
}

describe('QuickAddTicket template mode', () => {
  beforeEach(() => {
    addTicketMock.mockReset();
    getTicketDuplicateSourceMock.mockReset();
    getTicketTemplateForCreateMock.mockReset();
    listTicketTemplatesForCreateMock.mockReset();
    clientSelectSpy.mockReset();
    boardSelectSpy.mockReset();
    getTicketTemplateForCreateMock.mockResolvedValue(makeTemplate());
    listTicketTemplatesForCreateMock.mockResolvedValue([
      { template_id: TEMPLATE_ID, name: 'Dept change', board_id: 'board-1' },
    ]);
    getContactsByClientMock.mockResolvedValue([]);
    getClientLocationsMock.mockResolvedValue([]);
    getTicketFormDataMock.mockResolvedValue({
      users: [{ user_id: 'user-9', first_name: 'Grace', last_name: 'Hopper' }],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-2', name: 'Closed', is_default: false, is_closed: true },
      { status_id: 'status-1', name: 'Open', is_default: true, is_closed: false },
    ]);
    addTicketMock.mockResolvedValue({ ticket_id: 'ticket-new', attributes: {} });
  });

  it('choosing a template fills the ticket fields, never calls the board handler, and leaves client/contact/assignee alone', async () => {
    renderQuickAdd();
    await pickTemplate();

    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Employee department change'));
    expect(screen.getByDisplayValue('Steps for the move')).toBeInTheDocument();
    expect(screen.getByTestId('board-picker-value')).toHaveTextContent('board-1');
    expect(screen.getByTestId('category-picker-value')).toHaveTextContent('subcat-1');
    await waitFor(() =>
      expect((screen.getByTestId('select-ticket-quick-add-priority') as HTMLSelectElement).value).toBe('priority-1')
    );
    expect(JSON.parse(screen.getByTestId('tag-picker').textContent || '[]')).toEqual([
      { tag_id: 'tag-1', tag_text: 'onboarding', background_color: '#111111', text_color: '#ffffff', isNew: false },
    ]);

    // R1: applied by setting state, not through handleBoardChange / handleClientChange.
    expect(boardSelectSpy).not.toHaveBeenCalled();
    expect(clientSelectSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('client-picker-value')).toHaveTextContent('');
    expect(screen.getByTestId('client-picker')).toHaveAttribute('data-async', 'true');
    expect(screen.queryByTestId('contact-picker-value')?.textContent ?? '').toBe(''); // contact is never taken from a template
    expect(screen.getByTestId('assigned-to-value')).toHaveTextContent('');

    // The board default status is picked by the status effect.
    await waitFor(() => expect((screen.getByTestId('select-ticket-quick-add') as HTMLSelectElement).value).toBe('status-1'));

    expect(screen.getByTestId('quick-add-ticket-template-pill')).toHaveTextContent('From template: Dept change');
    const checklist = screen.getByTestId('quick-add-ticket-template-checklist');
    expect(checklist).toHaveTextContent('Create accounts');
    expect(checklist).toHaveTextContent('Order laptop');
    expect(screen.getByTestId('quick-add-ticket-template-custom-fields')).toBeInTheDocument();
  });

  it('{{client}} renders the prefilled client name, then follows the picker selection (async picker, no client list)', async () => {
    getTicketTemplateForCreateMock.mockResolvedValue(makeTemplate({ title: 'Move for {{client}}' }));
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
      selectedClient: { client_id: 'client-1', client_name: 'Acme', client_type: 'company' },
    });
    renderQuickAdd({ prefilledClient: { id: 'client-1', name: 'Acme' } });
    await pickTemplate();
    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Move for Acme'));

    fireEvent.click(screen.getByRole('button', { name: 'Change client' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Move for Globex'));
  });

  it('submit sends ticket_template_id and the checklist opt-in, never a template status or attributes', async () => {
    renderQuickAdd();
    await pickTemplate();
    await waitFor(() => expect((screen.getByTestId('select-ticket-quick-add') as HTMLSelectElement).value).toBe('status-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Change client' }));
    await waitFor(() => expect(screen.getByTestId('client-picker-value')).toHaveTextContent('client-2'));

    fireEvent.click(document.getElementById('ticket-quick-add-submit-btn') as HTMLElement);
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = submittedFormData();
    expect(formData.get('ticket_template_id')).toBe(TEMPLATE_ID);
    expect(formData.get('template_copy_checklist')).toBe('true');
    expect(formData.get('status_id')).toBe('status-1');
    expect(formData.get('title')).toBe('Employee department change');
    expect(formData.has('duplicate_of_ticket_id')).toBe(false);
    expect(formData.has('attributes')).toBe(false);
  });

  it('sends template_copy_checklist=false when the checklist is unchecked', async () => {
    renderQuickAdd();
    await pickTemplate();
    const checkbox = (await screen.findByLabelText('Copy checklist items (unchecked)')) as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));
    await waitFor(() => expect((screen.getByTestId('select-ticket-quick-add') as HTMLSelectElement).value).toBe('status-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Change client' }));

    fireEvent.click(document.getElementById('ticket-quick-add-submit-btn') as HTMLElement);
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    expect(submittedFormData().get('template_copy_checklist')).toBe('false');
  });

  it('a dirty draft asks before a template replaces it', async () => {
    renderQuickAdd();
    const title = await screen.findByPlaceholderText('Ticket Title *');
    fireEvent.change(title, { target: { value: 'Half typed' } });

    await pickTemplate();
    expect(getTicketTemplateForCreateMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId('confirmation-dialog')).toBeInTheDocument();
    expect(title).toHaveValue('Half typed');

    fireEvent.click(within(screen.getByTestId('confirmation-dialog')).getByRole('button', { name: 'Apply template' }));
    await waitFor(() => expect(getTicketTemplateForCreateMock).toHaveBeenCalledWith(TEMPLATE_ID));
    await waitFor(() => expect(title).toHaveValue('Employee department change'));
  });

  it('cancelling the prompt keeps the draft', async () => {
    renderQuickAdd();
    const title = await screen.findByPlaceholderText('Ticket Title *');
    fireEvent.change(title, { target: { value: 'Half typed' } });
    await pickTemplate();
    fireEvent.click(within(await screen.findByTestId('confirmation-dialog')).getByRole('button', { name: 'Continue Editing' }));
    expect(getTicketTemplateForCreateMock).not.toHaveBeenCalled();
    expect(title).toHaveValue('Half typed');
  });

  it('an untouched template draft applies a second template without asking (template prefill is the baseline)', async () => {
    const other = '7c2e8e5f-2d1f-4d1b-8e7b-1d2a3a8b0c21';
    listTicketTemplatesForCreateMock.mockResolvedValue([
      { template_id: TEMPLATE_ID, name: 'Dept change', board_id: 'board-1' },
      { template_id: other, name: 'Other', board_id: 'board-1' },
    ]);
    getTicketTemplateForCreateMock.mockImplementation(async (id: string) =>
      id === other ? makeTemplate({ template_id: other, name: 'Other', title: 'Other title' }) : makeTemplate()
    );
    renderQuickAdd();
    await pickTemplate();
    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Employee department change'));

    fireEvent.change(screen.getByTestId(pickerId), { target: { value: other } });
    expect(screen.queryByTestId('confirmation-dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Other title'));
  });

  it('hides the picker in duplicate mode and when the user has no templates to use', async () => {
    getTicketDuplicateSourceMock.mockResolvedValue({
      ticket_id: 'src', ticket_number: 'TIC-1', title: 'T', description: '', client: null, contact: null,
      location_id: null, board_id: 'board-1', category_id: null, subcategory_id: null, priority_id: 'priority-1',
      itil_impact: null, itil_urgency: null, assigned_to: null, assigned_team_id: null, additional_agents: [],
      tags: [], checklist: [], custom_field_count: 0,
    });
    const first = renderQuickAdd({ duplicateFromTicketId: 'src' });
    await waitFor(() => expect(getTicketDuplicateSourceMock).toHaveBeenCalled());
    expect(screen.queryByTestId(pickerId)).not.toBeInTheDocument();
    first.unmount();

    listTicketTemplatesForCreateMock.mockResolvedValue({ permissionError: 'Permission denied' });
    renderQuickAdd();
    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    await waitFor(() => expect(listTicketTemplatesForCreateMock).toHaveBeenCalled());
    expect(screen.queryByTestId(pickerId)).not.toBeInTheDocument();
  });

  it('opening with templateId preloads the template and shows its warnings', async () => {
    getTicketTemplateForCreateMock.mockResolvedValue(
      makeTemplate({ board_id: null, category_id: null, subcategory_id: null, warnings: ['Board no longer exists'] })
    );
    renderQuickAdd({ templateId: TEMPLATE_ID });
    await waitFor(() => expect(getTicketTemplateForCreateMock).toHaveBeenCalledWith(TEMPLATE_ID));
    await waitFor(() => expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Employee department change'));
    expect(screen.getByTestId('quick-add-ticket-template-warnings')).toHaveTextContent('Board no longer exists');
    expect(screen.getByTestId('quick-add-ticket-template-pill')).toBeInTheDocument();
  });

  it('shows a load failure for a preloaded template that cannot be loaded', async () => {
    getTicketTemplateForCreateMock.mockResolvedValue({ actionError: 'Ticket template not found' });
    renderQuickAdd({ templateId: TEMPLATE_ID });
    expect(await screen.findByTestId('quick-add-ticket-template-error')).toHaveTextContent('Ticket template not found');
    expect(screen.queryByTestId('quick-add-ticket-template-pill')).not.toBeInTheDocument();
  });
});

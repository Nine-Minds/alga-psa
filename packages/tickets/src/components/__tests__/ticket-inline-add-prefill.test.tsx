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
  updateTicket: (...args: unknown[]) => updateTicketMock(...args)
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

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: function ClientPickerMock({ onSelect, selectedClientId, onAddNew, clients }: any) {
    useEffect(() => {
      if (!selectedClientId) {
        onSelect('client-1');
      }
    }, []);
    return (
      <div data-testid="client-picker">
        <div data-testid="client-picker-value">{selectedClientId}</div>
        <div data-testid="client-picker-count">{clients.length}</div>
        {onAddNew ? (
          <button type="button" onClick={onAddNew}>
            + Add new client
          </button>
        ) : null}
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
  default: function UserPickerMock({ onValueChange }: any) {
    useEffect(() => {
      onValueChange('user-1');
    }, []);
    return <div data-testid="user-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ onSelect }: any) => {
    useEffect(() => {
      onSelect('board-1');
    }, []);
    return <div data-testid="board-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ onValueChange, options, value }: any) => (
    <select
      data-testid="custom-select"
      value={value}
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

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
  getAllPriorities: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  uploadDocument: (...args: unknown[]) => uploadDocumentMock(...args)
}));

vi.mock('@alga-psa/ui/lib/errorHandling', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/ui/lib/errorHandling')>('@alga-psa/ui/lib/errorHandling');
  return {
    ...actual,
    isActionPermissionError: vi.fn(() => false),
  };
});

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
  QuickAddTagPicker: () => <div data-testid="tag-picker" />
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntity: vi.fn()
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn()
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <input data-testid="due-time" />
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false })
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) => {
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

vi.mock('../lib/ticketRichText', () => ({
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

vi.mock('../lib/ticketRichTextImages', () => ({
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

describe('QuickAddTicket prefills', () => {
  beforeEach(() => {
    addTicketMock.mockReset();
    pushMock.mockReset();
    updateTicketMock.mockReset();
    uploadDocumentMock.mockReset();
    getContactsByClientMock.mockResolvedValue([]);
    getClientLocationsMock.mockResolvedValue([]);
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      clients: [{ client_id: 'client-1', client_name: 'Acme', client_type: 'company' }],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
      selectedClient: { client_id: 'client-1', client_type: 'company' }
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-1', name: 'Open', is_default: true, is_closed: false },
    ]);
    addTicketMock.mockResolvedValue({ ticket_id: 'ticket-1', attributes: {} });
    updateTicketMock.mockResolvedValue({});
    uploadDocumentMock.mockResolvedValue({
      success: true,
      document: {
        document_id: 'doc-1',
        file_id: 'file-1',
      },
    });
  });

  it('initializes title input from prefilledTitle', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledTitle="Prefilled Title"
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Prefilled Title');
  });

  it('initializes assigned user from prefilledAssignedTo', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledAssignedTo="user-1"
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByTestId('user-picker')).toBeInTheDocument();
  });

  it('initializes due date from prefilledDueDate', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledDueDate={new Date('2026-02-05T12:00:00.000Z')}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByTestId('due-date')).toHaveValue('2026-02-05T12:00:00.000Z');
  });

  it('navigates to the created ticket when Create + View Ticket is clicked', async () => {
    const onTicketAdded = vi.fn();

    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={onTicketAdded}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-1'));

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'New ticket from quick add' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create + View Ticket' }));

    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    await waitFor(() => expect(onTicketAdded).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith('/msp/tickets/ticket-1');
  });

  it('T006: clicking add new contact opens QuickAddContact dialog', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-contact-dialog')).toBeInTheDocument();
  });

  it('T007: QuickAddContact receives the current selected client id', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-contact-client')).toHaveTextContent('client-1');
  });

  it('T008: creating a contact adds it locally and auto-selects it', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 });
    expect(screen.getByTestId('contact-picker-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: /\+ add new contact/i }));
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));

    await waitFor(() => expect(screen.queryByTestId('quick-add-contact-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('contact-picker-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('contact-picker-value')).toHaveTextContent('contact-new');
  });

  it('T021: clicking add new client opens QuickAddClient dialog', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new client/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-client-dialog')).toBeInTheDocument();
  });

  it('T022: creating a client adds it locally and auto-selects it', async () => {
    getTicketFormDataMock.mockResolvedValueOnce({
      users: [],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      clients: [{ client_id: 'client-1', client_name: 'Acme', client_type: 'company' }],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
    });

    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await screen.findByRole('button', { name: /\+ add new client/i }, { timeout: 5000 });
    expect(screen.getByTestId('client-picker-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /\+ add new client/i }));
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => expect(screen.queryByTestId('quick-add-client-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('client-picker-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('client-picker-value')).toHaveTextContent('client-new');
  });

  it('T041: clicking add new category opens QuickAddCategory with the selected board id', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await screen.findByRole('button', { name: /\+ add new category/i }, { timeout: 5000 });
    fireEvent.click(await screen.findByRole('button', { name: /\+ add new category/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-category-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-category-board')).toHaveTextContent('board-1');
  });

  it('serializes the quick-add description as rich text when creating a ticket', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-1'));

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'Rich text quick add' }
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Pasted markdown replacement' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    const submittedFormData = addTicketMock.mock.calls[0][0] as FormData;
    const serializedDescription = submittedFormData.get('description');

    expect(typeof serializedDescription).toBe('string');
    expect(serializedDescription).toContain('Pasted markdown replacement');
    expect(JSON.parse(serializedDescription as string)).toEqual([
      expect.objectContaining({
        type: 'paragraph',
      }),
    ]);
  });

  it('shows a discard dialog when closing quick add with staged pasted images', async () => {
    const onOpenChange = vi.fn();

    render(
      <QuickAddTicket
        open={true}
        onOpenChange={onOpenChange}
        onTicketAdded={() => undefined}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Paste Image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByTestId('confirmation-dialog')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Images' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('uploads staged clipboard images after ticket creation and persists the final description', async () => {
    const user = userEvent.setup();

    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-1'));

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'Ticket with pasted image' }
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Ticket body' }
    });
    await user.click(screen.getByRole('button', { name: 'Paste Image' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(uploadDocumentMock).toHaveBeenCalled());
    await waitFor(() => expect(updateTicketMock).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        attributes: expect.objectContaining({
          description: expect.stringContaining('/api/documents/view/file-1'),
        }),
      })
    ));
  });

  it('T010: Algadesk quick-add omits asset prefill banner and asset_id submission while PSA preserves both', async () => {
    const renderQuickAdd = (isAlgadeskMode: boolean) => render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        assetId="asset-123"
        assetName="Router A"
        isAlgadeskMode={isAlgadeskMode}
      />
    );

    renderQuickAdd(false);
    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByTestId('quick-add-ticket-asset-pill')).toHaveTextContent('Linked asset: Router A');
    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'PSA asset-linked quick add' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    const psaFormData = addTicketMock.mock.calls[0][0] as FormData;
    expect(psaFormData.get('asset_id')).toBe('asset-123');

    addTicketMock.mockClear();

    renderQuickAdd(true);
    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.queryByTestId('quick-add-ticket-asset-pill')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'Algadesk quick add' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    const algadeskFormData = addTicketMock.mock.calls[0][0] as FormData;
    expect(algadeskFormData.get('asset_id')).toBeNull();
  });

});

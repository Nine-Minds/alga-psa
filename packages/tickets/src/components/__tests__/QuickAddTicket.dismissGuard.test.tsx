/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuickAddTicket } from '../QuickAddTicket';
import { addTicket } from '../../actions/ticketActions';

const getTicketFormDataMock = vi.fn();
const getTicketStatusesMock = vi.fn();

// Real Dialog / ConfirmationDialog / dismiss guard on purpose: this test is about what
// Escape, the X button and Cmd+Arrow do to typed text in the new-ticket dialog.
vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ onContentChange }: { onContentChange?: (content: unknown[]) => void }) => (
    <div
      className="ProseMirror"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-label="Description editor"
      onInput={(event) =>
        onContentChange?.([
          { type: 'paragraph', content: [{ type: 'text', text: event.currentTarget.textContent ?? '', styles: {} }] },
        ])
      }
    />
  ),
}));

vi.mock('../useQuickAddRichTextUploadSession', () => ({
  useQuickAddRichTextUploadSession: ({ onDiscard }: { onDiscard: () => void }) => ({
    uploadFile: vi.fn(),
    requestDiscard: onDiscard,
    resetDraftTracking: vi.fn(),
    stagedClipboardImages: [],
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: vi.fn(),
  updateTicket: vi.fn(),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn(),
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args),
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientLocations: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
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
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/searchUsersForMentions', () => ({
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn(),
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
  assignTeamToTicket: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      // i18next's `t` accepts either `t(key, fallbackString, options)` or
      // `t(key, optionsObject)` where the options object carries `defaultValue`.
      const fallback =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : (fallbackOrOptions?.defaultValue as string | undefined);
      const options =
        typeof fallbackOrOptions === 'string' ? maybeOptions : fallbackOrOptions;

      if (!fallback) {
        return _key;
      }

      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
    },
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({
    renderQuickAddClient: () => null,
    renderQuickAddContact: () => null,
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => <div data-testid="contact-picker" />,
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({
    boards,
    onSelect,
    selectedBoardId,
  }: {
    boards: Array<{ board_id?: string | null; board_name?: string | null }>;
    onSelect: (boardId: string) => void;
    selectedBoardId: string | null;
  }) => (
    <div>
      <div data-testid="board-picker-selected">{selectedBoardId || ''}</div>
      {boards.map((board) => (
        <button key={board.board_id} type="button" onClick={() => onSelect(board.board_id || '')}>
          Select {board.board_name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id?: string;
    value?: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id || 'custom-select'}
      value={value || ''}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
      <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
      </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker" />,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />,
}));

vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />,
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntity: vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('../../lib/ticketRichTextImages', () => ({
  removeTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
  replaceTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
}));


const question = () => screen.queryByText('Discard unsaved changes?');

const pressEscape = (target: Element | Document = document) =>
  fireEvent.keyDown(target, { key: 'Escape', bubbles: true });

async function renderOpenDialog() {
  const onOpenChange = vi.fn();
  render(<QuickAddTicket open={true} onOpenChange={onOpenChange} onTicketAdded={vi.fn()} />);
  const title = await screen.findByPlaceholderText('Ticket Title *');
  const description = await screen.findByLabelText('Description editor');
  return { onOpenChange, title: title as HTMLInputElement, description };
}

function typeDescription(editor: HTMLElement, text: string) {
  editor.focus();
  editor.textContent = text;
  fireEvent.input(editor);
}

describe('QuickAddTicket never discards typed text without confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [],
      statuses: [],
      priorities: [],
      clients: [],
    });
    getTicketStatusesMock.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('Escape with a typed description asks first; Keep editing leaves dialog and text in place', async () => {
    const { onOpenChange, description } = await renderOpenDialog();
    typeDescription(description, 'Printer on floor 2 jams every morning');

    pressEscape(description);

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(question()).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Description editor').textContent).toBe('Printer on floor 2 jams every morning');
  });

  it('confirming Discard closes the dialog', async () => {
    const { onOpenChange, description } = await renderOpenDialog();
    typeDescription(description, 'draft');

    pressEscape(description);
    await waitFor(() => expect(question()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a typed title alone is protected as well', async () => {
    const { onOpenChange, title } = await renderOpenDialog();
    fireEvent.change(title, { target: { value: 'Printer jam' } });

    pressEscape(title);

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('the X button asks too', async () => {
    const { onOpenChange, description } = await renderOpenDialog();
    typeDescription(description, 'draft');

    fireEvent.click(document.querySelector('button[aria-label="Close"]')!);

    await waitFor(() => expect(question()).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Arrow in the description editor triggers nothing and leaves the text alone', async () => {
    const { onOpenChange, description } = await renderOpenDialog();
    typeDescription(description, 'draft');

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifier });
        description.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(question()).toBeNull();
    expect(screen.getByLabelText('Description editor').textContent).toBe('draft');
  });

  it('Escape on an untouched dialog still closes it', async () => {
    const { onOpenChange } = await renderOpenDialog();

    pressEscape();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(question()).toBeNull();
  });

  it('Escape after clearing the typed text closes without asking', async () => {
    const { onOpenChange, description } = await renderOpenDialog();
    typeDescription(description, 'oops');
    typeDescription(description, '');

    pressEscape(description);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(question()).toBeNull();
  });
});


describe('QuickAddTicket after a create starts (Create + View reload window)', () => {
  const createdTicket = { ticket_id: 'ticket-1', title: 'Printer jam', tags: [], attributes: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [{ board_id: 'board-a', board_name: 'Board A', priority_type: 'custom' }],
      statuses: [],
      priorities: [{ priority_id: 'priority-1', priority_name: 'P1', item_type: 'ticket', is_default: true }],
      clients: [],
      selectedClient: { client_id: 'client-1', client_type: 'company' },
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-1', name: 'New', is_default: true, is_closed: false },
    ]);
  });

  afterEach(() => cleanup());

  async function renderFilledDialog() {
    const onViewCreatedTicket = vi.fn();
    const onTicketAdded = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={onOpenChange}
        onTicketAdded={onTicketAdded}
        onViewCreatedTicket={onViewCreatedTicket}
        prefilledClient={{ id: 'client-1', name: 'Acme' }}
      />
    );
    const title = (await screen.findByPlaceholderText('Ticket Title *')) as HTMLInputElement;
    const description = await screen.findByLabelText('Description editor');
    fireEvent.click(await screen.findByRole('button', { name: 'Select Board A' }));
    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a'));
    fireEvent.change(title, { target: { value: 'Printer jam' } });
    typeDescription(description, 'Jams every morning');
    return { title, description, onViewCreatedTicket, onTicketAdded, onOpenChange };
  }

  const createViewButton = () => screen.getByRole('button', { name: /Create \+ View Ticket|Adding|Opening/ });
  const clickCreateView = async () => {
    await waitFor(() => expect((createViewButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(createViewButton());
  };

  const fireBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    return event;
  };

  const expectGuardOff = () => {
    const event = fireBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
    expect((event as { returnValue?: unknown }).returnValue).not.toBe('');
  };

  it('does not flag the draft as unsaved while Create + View is in flight, and Escape does not ask', async () => {
    const { description } = await renderFilledDialog();
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    let resolveCreate: (value: unknown) => void = () => {};
    vi.mocked(addTicket).mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }) as never);

    await clickCreateView();
    await waitFor(() => expect(addTicket).toHaveBeenCalledTimes(1));

    expectGuardOff();
    pressEscape(description);
    expect(question()).toBeNull();

    resolveCreate(createdTicket);
  });

  it('stays unguarded after the ticket is created and the host has been handed it', async () => {
    const { onViewCreatedTicket } = await renderFilledDialog();
    vi.mocked(addTicket).mockResolvedValue(createdTicket as never);

    await clickCreateView();
    await waitFor(() => expect(onViewCreatedTicket).toHaveBeenCalledTimes(1));
    // let `finally` flip isSubmitting back to false
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opening ticket…' })).toBeTruthy());

    expectGuardOff();
  });

  it('brings the guard back when the create fails', async () => {
    const { description } = await renderFilledDialog();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(addTicket).mockRejectedValue(new Error('boom'));

    await clickCreateView();
    await waitFor(() => expect(addTicket).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((createViewButton() as HTMLButtonElement).disabled).toBe(false));

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    pressEscape(description);
    await waitFor(() => expect(question()).toBeTruthy());
  });

  it('never creates twice after a successful Create + View (buttons, form submit, Cmd/Ctrl+Enter)', async () => {
    const { onViewCreatedTicket, title } = await renderFilledDialog();
    vi.mocked(addTicket).mockResolvedValue(createdTicket as never);

    await clickCreateView();
    await waitFor(() => expect(onViewCreatedTicket).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opening ticket…' })).toBeTruthy());

    expect((screen.getByRole('button', { name: 'Opening ticket…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opening ticket…' }));
    const form = title.closest('form');
    if (form) fireEvent.submit(form);
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true, bubbles: true });
    fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true, bubbles: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(addTicket).toHaveBeenCalledTimes(1);
    expect(onViewCreatedTicket).toHaveBeenCalledTimes(1);
  });

  it('two quick triggers while a create is pending reach addTicket once', async () => {
    const { title } = await renderFilledDialog();
    vi.mocked(addTicket).mockReturnValue(new Promise(() => {}) as never);

    await clickCreateView();
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true, bubbles: true });
    fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true, bubbles: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(addTicket).toHaveBeenCalledTimes(1);
  });
});

/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoHero } from './BentoHero';

const getTicketStatusesMock = vi.fn();
const getTicketCategoriesByBoardMock = vi.fn();
const useRegisterUnsavedChangesMock = vi.fn();
const usePageSaveShortcutMock = vi.fn();
const requestDiscardMock = vi.fn();
const resetDraftTrackingMock = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategoriesByBoard: (...args: unknown[]) => getTicketCategoriesByBoardMock(...args),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: (...args: unknown[]) => useRegisterUnsavedChangesMock(...args),
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  usePageSaveShortcut: (...args: unknown[]) => usePageSaveShortcutMock(...args),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button id={id} type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
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
    id: string;
    value?: string | null;
    options: Array<{ value: string; label: React.ReactNode }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      id={id}
      disabled={disabled}
      value={value ?? ''}
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

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="assignee-picker" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({
  BentoTile: ({ children, id }: { children: React.ReactNode; id: string }) => <section id={id}>{children}</section>,
  BentoTileEmpty: ({ children, id }: { children: React.ReactNode; id: string }) => <p id={id}>{children}</p>,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ id, content }: { id?: string; content: unknown }) => (
    <div data-testid={id ?? 'rich-text-viewer'}>{JSON.stringify(content)}</div>
  ),
  TextEditor: ({
    id,
    initialContent,
    onContentChange,
  }: {
    id: string;
    initialContent: unknown;
    onContentChange: (content: unknown) => void;
  }) => (
    <textarea
      data-testid={id}
      defaultValue={JSON.stringify(initialContent)}
      onChange={(event) => onContentChange(JSON.parse(event.target.value))}
    />
  ),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
}));

// Stand-in for the clipboard-upload session: discarding routes straight to the
// component's onDiscard (no pasted images tracked in these tests).
vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: (options: { onDiscard: () => void }) => ({
    draftClipboardImages: [],
    isDeletingDraftImages: false,
    keepDraftClipboardImages: vi.fn(),
    requestDiscard: () => {
      requestDiscardMock();
      options.onDiscard();
    },
    resetDraftTracking: resetDraftTrackingMock,
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    uploadFile: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    onConfirm,
    confirmLabel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    confirmLabel: string;
  }) => (
    isOpen ? <button type="button" onClick={onConfirm}>{confirmLabel}</button> : null
  ),
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: ({ onTakeTheirs }: { onTakeTheirs: () => void }) => (
    <button type="button" data-testid="field-conflict-take-theirs" onClick={onTakeTheirs}>
      Take theirs
    </button>
  ),
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../TicketNotificationSuppressionControl', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: { suppressContactNotifications: boolean; suppressInternalNotifications: boolean };
    onChange: (value: { suppressContactNotifications: boolean; suppressInternalNotifications: boolean }) => void;
  }) => (
    <label>
      Don't notify the customer
      <input
        aria-label="Don't notify the customer"
        type="checkbox"
        checked={value.suppressContactNotifications}
        onChange={(event) => onChange({
          suppressContactNotifications: event.target.checked,
          suppressInternalNotifications: value.suppressInternalNotifications && event.target.checked,
        })}
      />
    </label>
  ),
}));

const descriptionBlocks = (text: string) => [
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text, styles: {} }],
  },
];

const watchList = [{ type: 'contact', id: 'contact-1', email: 'watcher@example.com' }];

const baseTicket = {
  ticket_id: 'ticket-1',
  tenant: 'tenant-1',
  title: 'Printer offline',
  attributes: {
    description: JSON.stringify(descriptionBlocks('Printer will not come online')),
    watch_list: watchList,
  },
  status_id: 'status-a',
  priority_id: 'priority-high',
  board_id: 'board-a',
  category_id: 'cat-a',
  subcategory_id: 'subcat-a',
  assigned_to: 'user-1',
  due_date: null,
  response_state: null,
  policyApplied: false,
};

function renderHero(overrides: Partial<React.ComponentProps<typeof BentoHero>> = {}) {
  const props: React.ComponentProps<typeof BentoHero> = {
    id: 'bento-hero',
    ticket: baseTicket as any,
    statusOptions: [
      { value: 'status-a', label: 'Open', board_id: 'board-a' },
      { value: 'status-b', label: 'New board open', board_id: 'board-b' },
    ],
    priorityOptions: [
      { value: 'priority-high', label: 'High' },
      { value: 'priority-low', label: 'Low' },
    ],
    boardOptions: [
      { value: 'board-a', label: 'Support' },
      { value: 'board-b', label: 'Projects' },
    ],
    agentOptions: [],
    availableAgents: [],
    onSelectChange: vi.fn(),
    onBatchSelectChange: vi.fn().mockResolvedValue(true),
    onOpenAllFields: vi.fn(),
    onLiveDirtyFieldsChange: vi.fn(),
    ...overrides,
  };

  render(<BentoHero {...props} />);
  return props;
}

describe('BentoHero unsaved change model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketStatusesMock.mockImplementation(async (boardId: string) => [
      {
        status_id: boardId === 'board-b' ? 'status-b' : 'status-a',
        name: boardId === 'board-b' ? 'New board open' : 'Open',
        is_closed: false,
      },
    ]);
    getTicketCategoriesByBoardMock.mockImplementation(async (boardId: string) => ({
      categories: boardId === 'board-b'
        ? [{ category_id: 'cat-b', category_name: 'Project category' }]
        : [{ category_id: 'cat-a', category_name: 'Support category' }],
      boardConfig: {
        category_type: 'custom',
        priority_type: boardId === 'board-b' ? 'itil' : 'custom',
        display_itil_impact: false,
        display_itil_urgency: false,
      },
    }));
  });

  it('T036/T056/T068: buffers field edits and sends suppression options only on Save', async () => {
    const onBatchSelectChange = vi.fn().mockResolvedValue(true);
    renderHero({ onBatchSelectChange });

    fireEvent.change(screen.getByTestId('bento-hero-priority-select'), {
      target: { value: 'priority-low' },
    });

    expect(onBatchSelectChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
    // Entry-view parity: a persistent banner flags the dirty state for ANY
    // pending field, not just board changes.
    expect(
      screen.getByText('You have unsaved changes. Click "Save Changes" to apply them.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Don't notify the customer"));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onBatchSelectChange).toHaveBeenCalledWith(
        { priority_id: 'priority-low' },
        { suppressContactNotifications: true, suppressInternalNotifications: false },
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    });
    expect(
      screen.queryByText('You have unsaved changes. Click "Save Changes" to apply them.'),
    ).not.toBeInTheDocument();
  });

  it('T059/T061-T064: board change clears scoped fields, gates Save, and persists one batch', async () => {
    const onBatchSelectChange = vi.fn().mockResolvedValue(true);
    renderHero({ onBatchSelectChange });

    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-a'));

    fireEvent.change(screen.getByTestId('bento-hero-board-select'), {
      target: { value: 'board-b' },
    });

    expect(screen.getByTestId('bento-hero-status-select')).toHaveValue('');
    expect(screen.getByTestId('bento-hero-category-select')).toHaveValue('');
    expect(screen.getByText('Select a status for the new board before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled();

    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-b'));
    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-b'));

    fireEvent.change(screen.getByTestId('bento-hero-status-select'), {
      target: { value: 'status-b' },
    });
    fireEvent.change(screen.getByTestId('bento-hero-category-select'), {
      target: { value: 'cat-b' },
    });

    const saveButton = screen.getByRole('button', { name: /Save Changes/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onBatchSelectChange).toHaveBeenCalledWith({
        board_id: 'board-b',
        status_id: 'status-b',
        category_id: 'cat-b',
        subcategory_id: null,
        priority_id: null,
      });
    });
  });

  it('re-selecting the original board clears the staged board-scoped nulls (no unsaveable diff)', async () => {
    const onBatchSelectChange = vi.fn().mockResolvedValue(true);
    const onLiveDirtyFieldsChange = vi.fn();
    renderHero({ onBatchSelectChange, onLiveDirtyFieldsChange });

    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-a'));

    fireEvent.change(screen.getByTestId('bento-hero-board-select'), {
      target: { value: 'board-b' },
    });
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled();

    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-b'));
    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-b'));

    fireEvent.change(screen.getByTestId('bento-hero-board-select'), {
      target: { value: 'board-a' },
    });

    // Returning to the saved board restores status/category/priority, so the
    // pending diff self-cleans: no save bar, no warning, no {status_id: null}.
    // Generous timeout: under Nx parallel load the board-a refetch chain that
    // self-cleans the diff can outlast waitFor's 1s default — and on a wide
    // affected set (many projects at --parallel=3 on a 4-vCPU runner) fork
    // starvation has blown through 5s too.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    }, { timeout: 15_000 });
    await waitFor(() => {
      expect(onLiveDirtyFieldsChange).toHaveBeenLastCalledWith([]);
    }, { timeout: 15_000 });
    expect(screen.queryByText('Select a status for the new board before saving.')).not.toBeInTheDocument();
    expect(screen.getByTestId('bento-hero-status-select')).toHaveValue('status-a');
  });

  it('keeps the ticket\'s current status selectable when the board fetch omits it', async () => {
    getTicketStatusesMock.mockImplementation(async () => [
      { status_id: 'status-x', name: 'Board-only status', is_closed: false },
    ]);
    renderHero({});

    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a'));

    // The saved status (a global/legacy status the board fetch doesn't return)
    // must not vanish from the select — a blank status control reads as data loss.
    await waitFor(() => {
      expect(screen.getByTestId('bento-hero-status-select')).toHaveValue('status-a');
    });
    expect(screen.getByRole('option', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Board-only status' })).toBeInTheDocument();
  });

  it('T057/T066: registers the nav guard, reports dirty fields, and wires the save shortcut', async () => {
    const onLiveDirtyFieldsChange = vi.fn();
    renderHero({ onLiveDirtyFieldsChange });

    expect(useRegisterUnsavedChangesMock).toHaveBeenLastCalledWith('ticket-bento-hero-bento-hero', false);
    expect(usePageSaveShortcutMock).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ enabled: false }));

    fireEvent.change(screen.getByTestId('bento-hero-priority-select'), {
      target: { value: 'priority-low' },
    });

    await waitFor(() => {
      expect(useRegisterUnsavedChangesMock).toHaveBeenLastCalledWith('ticket-bento-hero-bento-hero', true);
      expect(onLiveDirtyFieldsChange).toHaveBeenLastCalledWith(['priority_id']);
      expect(usePageSaveShortcutMock).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ enabled: true }));
    });
  });

  it('T058: cancel opens a discard confirmation and reverts pending changes', async () => {
    renderHero();

    fireEvent.change(screen.getByTestId('bento-hero-priority-select'), {
      target: { value: 'priority-low' },
    });

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('bento-hero-priority-select')).toHaveValue('priority-high');
    });
  });

  it('renders the ticket description inline with the opened-by caption', () => {
    renderHero({
      createdByUser: { first_name: 'Ada', last_name: 'Lovelace' } as any,
      ticket: { ...baseTicket, source: 'email' } as any,
    });

    expect(screen.getByTestId('bento-hero-description-view')).toHaveTextContent(
      'Printer will not come online',
    );
    // The caption replaces what the old Request tile carried.
    expect(screen.getByText(/Opened by/)).toBeInTheDocument();
  });

  it('flags the description edit as unsaved and flushes it inside the hero batch', async () => {
    const onBatchSelectChange = vi.fn().mockResolvedValue(true);
    renderHero({ onBatchSelectChange });

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.change(screen.getByTestId('bento-hero-description-editor'), {
      target: { value: JSON.stringify(descriptionBlocks('Toner cartridge replaced')) },
    });

    expect(useRegisterUnsavedChangesMock).toHaveBeenLastCalledWith('ticket-bento-hero-bento-hero', true);
    expect(
      screen.getByText('You have unsaved changes. Click "Save Changes" to apply them.'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('bento-hero-priority-select'), {
      target: { value: 'priority-low' },
    });
    fireEvent.click(screen.getByLabelText("Don't notify the customer"));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      // ONE batch: the pending field plus the merged attributes, and the
      // pre-existing watch list must survive the description write.
      expect(onBatchSelectChange).toHaveBeenCalledWith(
        {
          priority_id: 'priority-low',
          attributes: {
            watch_list: watchList,
            description: JSON.stringify(descriptionBlocks('Toner cartridge replaced')),
          },
        },
        { suppressContactNotifications: true, suppressInternalNotifications: false },
      );
    });
    expect(onBatchSelectChange).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('bento-hero-description-editor')).not.toBeInTheDocument();
    expect(resetDraftTrackingMock).toHaveBeenCalled();
  });

  it('falls back to onUpdateDescription when no batch handler is wired', async () => {
    const onUpdateDescription = vi.fn().mockResolvedValue(true);
    renderHero({ onBatchSelectChange: undefined, onUpdateDescription });

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.change(screen.getByTestId('bento-hero-description-editor'), {
      target: { value: JSON.stringify(descriptionBlocks('Escalated to vendor')) },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onUpdateDescription).toHaveBeenCalledWith(
        JSON.stringify(descriptionBlocks('Escalated to vendor')),
      );
    });
  });

  it('opening the description editor offers a cancel exit with Save still gated', async () => {
    renderHero();

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled();
    expect(
      screen.queryByText('You have unsaved changes. Click "Save Changes" to apply them.'),
    ).not.toBeInTheDocument();

    // No pending diff, so Cancel closes the editor without a confirmation.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByTestId('bento-hero-description-editor')).not.toBeInTheDocument();
    });
  });

  it('cancel discards the description draft through the upload session', async () => {
    renderHero();

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.change(screen.getByTestId('bento-hero-description-editor'), {
      target: { value: JSON.stringify(descriptionBlocks('Draft never saved')) },
    });

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));

    await waitFor(() => {
      expect(requestDiscardMock).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('bento-hero-description-view')).toHaveTextContent(
      'Printer will not come online',
    );
  });

  it('T067: taking a remote board conflict clears coupled pending fields', async () => {
    const onLiveDirtyFieldsChange = vi.fn();
    const onTakeLiveConflict = vi.fn();
    renderHero({
      onLiveDirtyFieldsChange,
      onTakeLiveConflict,
      liveFieldConflicts: {
        board_id: {
          field: 'board_id',
          localValue: 'board-b',
          remoteValue: 'board-a',
          updatedAt: '2026-07-09T12:00:00.000Z',
          updatedBy: { userId: 'user-remote', displayName: 'Remote User' },
        },
      } as any,
    });

    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-a'));
    fireEvent.change(screen.getByTestId('bento-hero-board-select'), {
      target: { value: 'board-b' },
    });

    await waitFor(() => {
      expect(onLiveDirtyFieldsChange).toHaveBeenLastCalledWith(
        expect.arrayContaining(['board_id', 'status_id', 'category_id', 'subcategory_id']),
      );
    });

    fireEvent.click(screen.getByTestId('field-conflict-take-theirs'));

    await waitFor(() => {
      expect(onTakeLiveConflict).toHaveBeenCalledWith('board_id');
      expect(onLiveDirtyFieldsChange).toHaveBeenLastCalledWith([]);
    });
  });
});

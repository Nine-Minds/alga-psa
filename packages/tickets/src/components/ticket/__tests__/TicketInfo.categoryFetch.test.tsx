/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import TicketInfo from '../TicketInfo';

const getTicketCategoriesByBoardMock = vi.fn();
const getTicketCategoriesMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ content }: { content: string }) => <div>{content}</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: () => <select data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({
  PrioritySelect: () => <div data-testid="priority-select" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <button type="button">Assignee</button>,
}));

vi.mock('../../CategoryPicker', () => ({
  CategoryPicker: ({ categories }: { categories: Array<{ category_id: string; category_name: string }> }) => (
    <div data-testid="category-picker">{categories.map((category) => category.category_name).join(',')}</div>
  ),
}));

vi.mock('../../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <button type="button">Due date</button>,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <button type="button">Due date and time</button>,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../../ResponseStateSelect', () => ({
  ResponseStateDisplay: () => <button type="button">Response state</button>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _containerClassName, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/sla', () => ({
  SlaStatusBadge: () => <div data-testid="sla-status-badge" />,
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: () => <div data-testid="field-conflict-banner" />,
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    deleteDocument: vi.fn(),
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([
    { status_id: 'status-a', name: 'Open', is_closed: false },
  ]),
}));

// TicketInfo imports these straight from the module, not through the
// @alga-psa/tickets/actions barrel; mocking the barrel leaves the real
// server action in place and the component fires it at a database that a
// unit run does not have.
vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategories: (...args: unknown[]) => getTicketCategoriesMock(...args),
  getTicketCategoriesByBoard: (...args: unknown[]) => getTicketCategoriesByBoardMock(...args),
}));

vi.mock('../../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue('[]'),
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

const boardConfig = {
  category_type: 'custom' as const,
  priority_type: 'custom' as const,
  display_itil_impact: false,
  display_itil_urgency: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ticketOnBoard(boardId: string) {
  return {
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Category fetch test',
    status_id: 'status-a',
    board_id: boardId,
    assigned_to: null,
    category_id: null,
    subcategory_id: null,
    priority_id: 'priority-1',
    due_date: null,
    response_state: null,
    attributes: { description: '' },
    sla_policy_id: null,
    sla_paused_at: null,
    sla_response_at: null,
    sla_response_due_at: null,
    sla_resolution_at: null,
    sla_resolution_due_at: null,
    sla_started_at: null,
    entered_at: new Date('2026-03-14T10:00:00.000Z').toISOString(),
  } as any;
}

function renderTicketInfo(boardId: string) {
  return render(<TicketInfoHarness boardId={boardId} />);
}

function TicketInfoHarness({ boardId }: { boardId: string }) {
  return (
    <TicketInfo
      id="ticket-info"
      ticket={ticketOnBoard(boardId)}
      conversations={[]}
      statusOptions={[{ value: 'status-a', label: 'Open' }]}
      agentOptions={[]}
      boardOptions={[
        { value: 'board-a', label: 'Board A' },
        { value: 'board-b', label: 'Board B' },
      ]}
      priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
      onSelectChange={vi.fn()}
      onSaveChanges={vi.fn().mockResolvedValue(true)}
      responseStateTrackingEnabled={false}
    />
  );
}

describe('TicketInfo category fetch lifecycle', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getTicketCategoriesMock.mockResolvedValue([]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('T044: a board fetch that fails after unmount is neither reported nor applied', async () => {
    const pending = deferred<never>();
    getTicketCategoriesByBoardMock.mockReturnValue(pending.promise);

    const view = renderTicketInfo('board-a');
    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-a'));

    view.unmount();

    // The unit suite has no database behind the server action, so in CI this
    // rejection lands on a component React has already discarded — the state
    // update it used to trigger surfaced as "window is not defined" once the
    // test environment had been torn down.
    await act(async () => {
      pending.reject(new Error('board lookup failed'));
      await pending.promise.catch(() => {});
    });

    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Failed to fetch categories:', expect.anything());
  });

  it('T045: a board fetch that loses the race does not overwrite the newly selected board', async () => {
    const boardA = deferred<{ categories: Array<{ category_id: string; category_name: string }>; boardConfig: typeof boardConfig }>();
    const boardB = deferred<{ categories: Array<{ category_id: string; category_name: string }>; boardConfig: typeof boardConfig }>();
    getTicketCategoriesByBoardMock.mockImplementation((boardId: string) =>
      boardId === 'board-a' ? boardA.promise : boardB.promise
    );

    const view = renderTicketInfo('board-a');
    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-a'));

    view.rerender(<TicketInfoHarness boardId="board-b" />);
    await waitFor(() => expect(getTicketCategoriesByBoardMock).toHaveBeenCalledWith('board-b'));

    await act(async () => {
      boardB.resolve({ categories: [{ category_id: 'cat-b', category_name: 'Software' }], boardConfig });
      await boardB.promise;
    });
    expect(screen.getByTestId('category-picker')).toHaveTextContent('Software');

    await act(async () => {
      boardA.resolve({ categories: [{ category_id: 'cat-a', category_name: 'Hardware' }], boardConfig });
      await boardA.promise;
    });

    expect(screen.getByTestId('category-picker')).toHaveTextContent('Software');
    expect(screen.getByTestId('category-picker')).not.toHaveTextContent('Hardware');
  });
});

/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const checkTicketClosureMock = vi.fn();
const updateCommentMock = vi.fn();
const findCommentByIdMock = vi.fn();
const updateTicketMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();
const findBoardByIdMock = vi.fn();
const getTicketByIdMock = vi.fn();
const previewBundlePropagationMock = vi.fn();
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

const existingComment = {
  comment_id: 'comment-1',
  ticket_id: 'ticket-1',
  user_id: 'user-1',
  note: '[]',
  is_internal: false,
  is_resolution: false,
  created_at: new Date().toISOString(),
} as any;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-1',
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/core', () => ({
  utcToLocal: (value: string) => new Date(value),
  formatDateTime: () => 'formatted',
  getUserTimeZone: () => 'UTC',
  generateUUID: () => 'holder-id',
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentByTicketId: vi.fn().mockResolvedValue([]),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), replaceDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({
    launchTimeEntry: vi.fn(),
    launchScheduleEntry: vi.fn(),
    fetchTimeEntriesForTicket: vi.fn(),
    deleteTimeEntry: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/components', () => ({
  ResponseStateBadge: () => <div data-testid="response-state" />,
  ContentCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/presence/PresenceBar', () => ({
  PresenceBar: () => <div data-testid="presence-bar" />,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

// The real dialog and select pull in Radix measurement APIs jsdom lacks; these
// stand-ins keep the spec on the prompt's wiring.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children }: { id?: string; isOpen?: boolean; title?: string; children?: React.ReactNode }) =>
    isOpen ? (
      <div id={id}>
        <div>{title}</div>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    label,
    value,
    options,
    onValueChange,
  }: {
    id: string;
    label?: string;
    value: string | null;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select id={id} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
        <option value="">none</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (value: number) => String(value),
    formatCurrency: (value: number) => String(value),
    formatRelativeTime: (date: Date | string) => String(date),
  }),
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      if (fallback && typeof fallback === 'object') {
        fallback = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : undefined;
      }
      return typeof fallback === 'string' ? fallback : _key;
    },
  }),
}));

vi.mock('@alga-psa/tags/context', () => ({ useTags: () => ({ tags: [] }) }));
vi.mock('@alga-psa/tags/actions', () => ({ findTagsByEntityId: vi.fn().mockResolvedValue([]) }));

vi.mock('@alga-psa/tickets/actions', () => ({
  findBoardById: (...args: unknown[]) => findBoardByIdMock(...args),
  findCommentsByTicketId: vi.fn().mockResolvedValue([]),
  deleteComment: vi.fn(),
  createComment: vi.fn(),
  updateComment: (...args: unknown[]) => updateCommentMock(...args),
  findCommentById: (...args: unknown[]) => findCommentByIdMock(...args),
  addTicketResource: vi.fn(),
  getTicketResources: vi.fn().mockResolvedValue([]),
  removeTicketResource: vi.fn(),
  assignTeamToTicket: vi.fn().mockResolvedValue(undefined),
  removeTeamFromTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../actions/board-actions/boardActions', () => ({
  findBoardById: (...args: unknown[]) => findBoardByIdMock(...args),
}));

vi.mock('../../../actions/comment-actions/commentActions', () => ({
  findCommentsByTicketId: vi.fn().mockResolvedValue([]),
  deleteComment: vi.fn(),
  createComment: vi.fn(),
  updateComment: (...args: unknown[]) => updateCommentMock(...args),
  findCommentById: (...args: unknown[]) => findCommentByIdMock(...args),
}));

vi.mock('../../../actions/close-rules/closeRuleActions', () => ({
  checkTicketClosure: (...args: unknown[]) => checkTicketClosureMock(...args),
  getTicketAutoCloseState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getCurrentUserPermissions: vi.fn().mockResolvedValue([]),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([]),
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamById: vi.fn().mockResolvedValue(null),
  getTeams: vi.fn().mockResolvedValue([]),
  isTeamActionError: () => false,
}));

vi.mock('../../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: vi
    .fn()
    .mockResolvedValue({ dateTimeFormat: 'MMM d, yyyy h:mm a', responseStateTrackingEnabled: true }),
}));

vi.mock('../../../actions/clientLookupActions', () => ({
  getAllActiveContacts: vi.fn().mockResolvedValue([]),
  getClientLocations: vi.fn().mockResolvedValue([]),
  getContactByContactNameId: vi.fn().mockResolvedValue(null),
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientById: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../actions/optimizedTicketActions', () => ({
  updateTicketWithCache: (...args: unknown[]) => updateTicketWithCacheMock(...args),
  addTicketCommentWithCache: vi.fn().mockResolvedValue('success'),
}));

vi.mock('../../../actions/ticketActions', () => ({
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
  updateTicket: (...args: unknown[]) => updateTicketMock(...args),
  deleteTicket: vi.fn().mockResolvedValue('success'),
}));

vi.mock('../../../actions/ticketBundleActions', () => ({
  addChildrenToBundleAction: vi.fn(),
  findTicketByNumberAction: vi.fn(),
  promoteBundleMasterAction: vi.fn(),
  removeChildFromBundleAction: vi.fn(),
  unbundleMasterTicketAction: vi.fn(),
  updateBundleSettingsAction: vi.fn(),
  searchEligibleChildTicketsAction: vi.fn(),
  previewBundleStatusPropagationAction: (...args: unknown[]) => previewBundlePropagationMock(...args),
}));

vi.mock('../../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../TicketInfo', () => ({ __esModule: true, default: () => <div data-testid="ticket-info" /> }));
vi.mock('../TicketProperties', () => ({ __esModule: true, default: () => <div data-testid="ticket-properties" /> }));
vi.mock('../TicketDocumentsSection', () => ({ __esModule: true, default: () => <div data-testid="ticket-documents" /> }));
vi.mock('../TicketEmailNotifications', () => ({ __esModule: true, default: () => <div data-testid="ticket-email" /> }));
vi.mock('../AgentScheduleDrawer', () => ({ __esModule: true, default: () => <div data-testid="agent-schedule" /> }));
vi.mock('../TicketNavigation', () => ({ __esModule: true, default: () => <div data-testid="ticket-navigation" /> }));
vi.mock('../TicketResolutionDialog', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketLiveProvider', () => ({
  useTicketLiveContext: () => ({
    enabled: false,
    presence: [],
    connectionStatus: 'unavailable' as const,
    setEditingField: vi.fn(),
    lastRemoteUpdate: null,
    reconnectVersion: 0,
  }),
}));
vi.mock('../../TicketOriginBadge', () => ({ __esModule: true, default: () => <div data-testid="origin-badge" /> }));
vi.mock('@alga-psa/ui/components/BackNav', () => ({ __esModule: true, default: () => <div data-testid="back-nav" /> }));

// Stand-in for the conversation: drives the edit handler that owns
// currentComment, then the save that flips is_resolution on.
vi.mock('../TicketConversation', () => ({
  __esModule: true,
  default: ({
    onEdit,
    onSave,
  }: {
    onEdit: (comment: unknown) => void;
    onSave: (updates: Record<string, unknown>) => void | Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => onEdit(existingComment)}>
        edit-comment
      </button>
      <button type="button" onClick={() => void onSave({ is_resolution: true })}>
        save-as-resolution
      </button>
      <button type="button" onClick={() => void onSave({ note: '[]' })}>
        save-plain-edit
      </button>
    </div>
  ),
}));

const baseTicket = {
  ticket_id: 'ticket-1',
  ticket_number: 'T-001',
  title: 'Test Ticket',
  tenant: 'tenant-1',
  board_id: 'board-1',
  client_id: 'client-1',
  contact_name_id: null,
  status_id: 'status-open',
  category_id: null,
  subcategory_id: null,
  entered_by: 'user-1',
  updated_by: null,
  closed_by: null,
  assigned_to: null,
  entered_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  url: null,
  attributes: {},
} as any;

const statusOptions = [
  { value: 'status-open', label: 'Open', is_closed: false, board_id: 'board-1' },
  { value: 'status-closed', label: 'Closed', is_closed: true, board_id: 'board-1' },
];

const board = { board_id: 'board-1', board_name: 'Board', enable_live_ticket_timer: false };

function renderDetails() {
  return render(
    <TicketDetails
      bootstrap={entryLayoutBootstrap}
      initialTicket={baseTicket}
      initialBoard={board}
      initialComments={[existingComment]}
      statusOptions={statusOptions}
    />,
  );
}

async function flagCommentAsResolution() {
  fireEvent.click(await screen.findByRole('button', { name: 'edit-comment' }));
  fireEvent.click(screen.getByRole('button', { name: 'save-as-resolution' }));
}

describe('TicketDetails edit-to-resolution close prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBoardByIdMock.mockResolvedValue(board);
    getTicketByIdMock.mockResolvedValue(baseTicket);
    updateCommentMock.mockResolvedValue('success');
    findCommentByIdMock.mockResolvedValue({ ...existingComment, is_resolution: true });
    updateTicketMock.mockResolvedValue('success');
    updateTicketWithCacheMock.mockResolvedValue('success');
    previewBundlePropagationMock.mockResolvedValue({
      mode: 'sync_updates',
      masterTicketId: 'ticket-1',
      newStatusId: 'status-closed',
      crossesBoundary: null,
      affectedChildren: [],
      unaffectedChildren: [],
    });
    checkTicketClosureMock.mockResolvedValue({
      wouldClose: true,
      allowed: true,
      failures: [],
      canOverride: false,
    });
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  it('offers the close once an edit flags the comment as the resolution', async () => {
    renderDetails();
    await flagCommentAsResolution();

    await waitFor(() => {
      expect(document.getElementById('ticket-details-resolution-close-prompt')).not.toBeNull();
    });
    // The board has exactly one closed status, so it is preselected.
    expect(screen.getByLabelText('Close status')).toHaveValue('status-closed');
  });

  it('does not offer the close for an edit that leaves is_resolution alone', async () => {
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'edit-comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'save-plain-edit' }));

    await waitFor(() => expect(updateCommentMock).toHaveBeenCalled());
    expect(document.getElementById('ticket-details-resolution-close-prompt')).toBeNull();
  });

  it('closes the ticket through the shared close path on confirm', async () => {
    renderDetails();
    await flagCommentAsResolution();

    const confirm = await waitFor(() => {
      const el = document.getElementById('ticket-details-resolution-close-prompt-confirm');
      if (!el) throw new Error('close prompt confirm not rendered');
      return el as HTMLButtonElement;
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(updateTicketMock).toHaveBeenCalledWith('ticket-1', { status_id: 'status-closed' });
    });
    await waitFor(() => {
      expect(document.getElementById('ticket-details-resolution-close-prompt')).toBeNull();
    });
  });

  it('leaves the status untouched when the close is declined', async () => {
    renderDetails();
    await flagCommentAsResolution();

    const decline = await waitFor(() => {
      const el = document.getElementById('ticket-details-resolution-close-prompt-decline');
      if (!el) throw new Error('close prompt decline not rendered');
      return el as HTMLButtonElement;
    });
    fireEvent.click(decline);

    expect(document.getElementById('ticket-details-resolution-close-prompt')).toBeNull();
    expect(updateTicketMock).not.toHaveBeenCalled();
    expect(updateTicketWithCacheMock).not.toHaveBeenCalled();
  });

  it('opens the blocked-close dialog when close rules are unmet and the customer is silenced', async () => {
    checkTicketClosureMock.mockResolvedValue({
      wouldClose: true,
      allowed: false,
      failures: [{ rule: 'checklist_incomplete', message: 'Checklist incomplete' }],
      canOverride: true,
    });
    renderDetails();
    await flagCommentAsResolution();

    const suppress = await waitFor(() =>
      screen.getByRole('checkbox', { name: "Don't notify the customer" }),
    );
    fireEvent.click(suppress);
    fireEvent.click(document.getElementById('ticket-details-resolution-close-prompt-confirm')!);

    await waitFor(() => {
      expect(document.getElementById('ticket-details-close-blocked-dialog')).not.toBeNull();
    });
    expect(updateTicketMock).not.toHaveBeenCalled();
  });
});

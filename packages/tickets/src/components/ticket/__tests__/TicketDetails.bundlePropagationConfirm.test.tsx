/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const checkTicketClosureMock = vi.fn();
const previewBundlePropagationMock = vi.fn();
const addTicketCommentWithCacheMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();
const findBoardByIdMock = vi.fn();
const getTicketByIdMock = vi.fn();
const launchTimeEntryMock = vi.fn();
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
let liveTicketContext = {
  enabled: false,
  presence: [] as Array<{ userId: string; displayName: string; avatarUrl?: string | null; color: string }>,
  connectionStatus: 'unavailable' as 'connecting' | 'connected' | 'reconnecting' | 'unavailable',
  setEditingField: vi.fn(),
  lastRemoteUpdate: null,
  reconnectVersion: 0,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-1',
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    replaceDrawer: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({
    launchTimeEntry: launchTimeEntryMock,
    launchScheduleEntry: vi.fn(),
    fetchTimeEntriesForTicket: vi.fn(),
    deleteTimeEntry: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
  useTicketTimeTracking: () => ({
    isTracking: false,
    currentIntervalId: null,
    isLockedByOther: false,
    startTracking: vi.fn().mockResolvedValue(false),
    stopTracking: vi.fn().mockResolvedValue(undefined),
    refreshLockState: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@alga-psa/ui/services', () => ({
  IntervalTrackingService: class {
    endInterval = vi.fn().mockResolvedValue(undefined);
    getOpenInterval = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('@alga-psa/ui/components', () => ({
  ResponseStateBadge: () => <div data-testid="response-state" />,
  ContentCard: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <div data-testid="content-card">
      {title ? <div>{title}</div> : null}
      {children}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/presence/PresenceBar', () => ({
  PresenceBar: () => <div data-testid="presence-bar" />,
}));

// Functional stand-in for the real ConfirmationDialog: the propagation confirm
// button must reflect only the `isConfirming` prop handed to it.
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    id,
    onConfirm,
    onCancel,
    thirdButtonLabel,
    isConfirming,
    confirmLabel,
  }: {
    isOpen?: boolean;
    id?: string;
    onConfirm?: () => unknown;
    onCancel?: () => unknown;
    thirdButtonLabel?: string;
    isConfirming?: boolean;
    confirmLabel?: string;
  }) => {
    if (!isOpen) return null;
    return (
      <div>
        <button
          type="button"
          id={`${id}-confirm`}
          disabled={Boolean(isConfirming)}
          onClick={() => void onConfirm?.()}
        >
          {confirmLabel ?? 'Confirm'}
        </button>
        {thirdButtonLabel && onCancel ? (
          <button type="button" id={`${id}-cancel`} onClick={() => void onCancel()}>
            {thirdButtonLabel}
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
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
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', options).format(value),
    formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', { style: 'currency', currency, ...options }).format(value),
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

vi.mock('@alga-psa/tags/context', () => ({
  useTags: () => ({ tags: [] }),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  findBoardById: (...args: unknown[]) => findBoardByIdMock(...args),
  findCommentsByTicketId: vi.fn().mockResolvedValue([]),
  deleteComment: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  findCommentById: vi.fn(),
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
  updateComment: vi.fn(),
  findCommentById: vi.fn(),
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
  addTicketCommentWithCache: (...args: unknown[]) => addTicketCommentWithCacheMock(...args),
}));

vi.mock('../../../actions/ticketActions', () => ({
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
  updateTicket: vi.fn().mockResolvedValue('success'),
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

vi.mock('../TicketInfo', () => ({
  __esModule: true,
  default: ({ onResolveAndClose }: { onResolveAndClose?: () => void }) => (
    <button type="button" onClick={() => onResolveAndClose?.()}>
      open-resolve-close
    </button>
  ),
}));

vi.mock('../TicketProperties', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-properties" />,
}));

vi.mock('../TicketDocumentsSection', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-documents" />,
}));

vi.mock('../TicketEmailNotifications', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-email-notifications" />,
}));

vi.mock('../TicketConversation', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-conversation" />,
}));

vi.mock('../AgentScheduleDrawer', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-schedule-drawer" />,
}));

vi.mock('../TicketNavigation', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-navigation" />,
}));

vi.mock('../TicketLiveProvider', () => ({
  useTicketLiveContext: () => liveTicketContext,
}));

vi.mock('../../TicketOriginBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-origin-badge" />,
}));

vi.mock('@alga-psa/ui/components/BackNav', () => ({
  __esModule: true,
  default: () => <div data-testid="back-nav" />,
}));

// The real resolution dialog would need its rich editor and upload session;
// this stand-in drives the same `onConfirm` contract the parent handler expects.
vi.mock('../TicketResolutionDialog', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: (
      statusId: string,
      blocks: unknown[],
      suppression: { suppressContactNotifications: boolean; suppressInternalNotifications: boolean },
    ) => Promise<boolean>;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() =>
          void onConfirm('status-closed', [], {
            suppressContactNotifications: false,
            suppressInternalNotifications: false,
          })
        }
      >
        confirm-resolution
      </button>
    ) : null,
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

describe('TicketDetails bundle propagation confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveTicketContext = {
      ...liveTicketContext,
      enabled: false,
      connectionStatus: 'unavailable',
      setEditingField: vi.fn(),
    };
    findBoardByIdMock.mockResolvedValue(board);
    getTicketByIdMock.mockResolvedValue(baseTicket);
    checkTicketClosureMock.mockResolvedValue({
      wouldClose: true,
      allowed: true,
      failures: [],
      canOverride: false,
    });
    addTicketCommentWithCacheMock.mockResolvedValue('success');
    updateTicketWithCacheMock.mockResolvedValue('success');
    previewBundlePropagationMock.mockResolvedValue({
      mode: 'sync_updates',
      masterTicketId: 'ticket-1',
      newStatusId: 'status-closed',
      crossesBoundary: 'close',
      affectedChildren: [{ ticket_id: 'child-1', ticket_number: 'C-001', title: 'Child', is_closed: false }],
      unaffectedChildren: [],
    });
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  it('enables the propagation confirm from resolve-and-close and writes propagateToChildren:true', async () => {
    render(
      <TicketDetails
        bootstrap={entryLayoutBootstrap}
        initialTicket={baseTicket}
        initialBoard={board}
        statusOptions={statusOptions}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'open-resolve-close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirm-resolution' }));

    // The propagation dialog must open with the confirm enabled — the operator
    // is choosing, not waiting on a write.
    const confirmButton = await waitFor(() => {
      const el = document.getElementById('bundle-status-propagation-dialog-confirm');
      if (!el) throw new Error('propagation confirm not rendered');
      return el as HTMLButtonElement;
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(updateTicketWithCacheMock).toHaveBeenCalledWith(
        'ticket-1',
        { status_id: 'status-closed' },
        expect.objectContaining({ propagateToChildren: true }),
      );
    });
  });
});

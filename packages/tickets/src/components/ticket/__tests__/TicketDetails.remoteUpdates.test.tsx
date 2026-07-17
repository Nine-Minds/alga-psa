/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import TicketDetails from '../TicketDetails';

const {
  routerPushMock,
  findBoardByIdMock,
  getTicketByIdMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  findBoardByIdMock: vi.fn(),
  getTicketByIdMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

let ticketInfoDirtyFields: string[] = [];
let ticketPropertiesDirtyFields: string[] = [];
let ticketInfoLocalFieldValues: Record<string, string> = {};
let liveTicketContext = {
  enabled: true,
  presence: [] as Array<{ userId: string; displayName: string; avatarUrl?: string | null; color: string }>,
  connectionStatus: 'connected' as 'connecting' | 'connected' | 'reconnecting' | 'unavailable',
  setEditingField: vi.fn(),
  lastRemoteUpdate: null as null | {
    updatedFields: string[];
    updatedBy: { userId: string; displayName: string };
    updatedAt: string;
  },
  reconnectVersion: 0,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-1',
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('@alga-psa/core', () => ({
  utcToLocal: (value: string) => new Date(value),
  formatDateTime: () => 'formatted',
  getUserTimeZone: () => 'UTC',
  generateUUID: () => 'holder-id',
}));

vi.mock(
  '@alga-psa/core/context/DocumentsCrossFeatureContext',
  () => ({
    useDocumentsCrossFeature: () => ({
      getDocumentByTicketId: vi.fn().mockResolvedValue([]),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    }),
  })
);

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionPermissionError: (value: unknown) => {
    const candidate = value as Record<string, unknown> | null;
    return Boolean(candidate && typeof candidate.permissionError === 'string');
  },
  isActionMessageError: () => false,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
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
    launchTimeEntry: vi.fn(),
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

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />
  ),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      // Mirror i18next's t(key, options) form where options carries defaultValue.
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
  updateTicketWithCache: vi.fn(),
}));

vi.mock('../../../actions/ticketActions', () => ({
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
  updateTicket: vi.fn().mockResolvedValue('success'),
}));

vi.mock('../../../actions/ticketBundleActions', () => ({
  addChildrenToBundleAction: vi.fn(),
  findTicketByNumberAction: vi.fn(),
  promoteBundleMasterAction: vi.fn(),
  removeChildFromBundleAction: vi.fn(),
  unbundleMasterTicketAction: vi.fn(),
  updateBundleSettingsAction: vi.fn(),
  searchEligibleChildTicketsAction: vi.fn(),
}));

vi.mock('../../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../TicketInfo', () => ({
  __esModule: true,
  default: function TicketInfoMock({
    ticket,
    onLiveDirtyFieldsChange,
    liveHighlightedFields = [],
    liveFieldConflicts = {},
    onKeepLiveConflict,
    onTakeLiveConflict,
  }: {
    ticket: { status_id?: string; priority_id?: string };
    onLiveDirtyFieldsChange?: (fields: string[]) => void;
    liveHighlightedFields?: string[];
    liveFieldConflicts?: Record<string, unknown>;
    onKeepLiveConflict?: (field: string) => void;
    onTakeLiveConflict?: (field: string) => void;
  }) {
    React.useEffect(() => {
      onLiveDirtyFieldsChange?.(ticketInfoDirtyFields);
      return () => onLiveDirtyFieldsChange?.([]);
    }, [onLiveDirtyFieldsChange]);

    const displayedStatus = ticketInfoDirtyFields.includes('status_id')
      ? (ticketInfoLocalFieldValues.status_id ?? ticket.status_id ?? '')
      : (ticket.status_id ?? '');
    const displayedPriority = ticketInfoDirtyFields.includes('priority_id')
      ? (ticketInfoLocalFieldValues.priority_id ?? ticket.priority_id ?? '')
      : (ticket.priority_id ?? '');

    return (
      <div>
        <div
          data-testid="ticket-info-status"
          data-status={displayedStatus}
          data-live-highlighted={liveHighlightedFields.includes('status_id') ? 'true' : undefined}
          data-live-conflict={liveFieldConflicts.status_id ? 'true' : undefined}
        />
        {liveFieldConflicts.status_id ? (
          <>
            <button type="button" data-testid="ticket-info-status-keep" onClick={() => onKeepLiveConflict?.('status_id')}>
              Keep yours
            </button>
            <button
              type="button"
              data-testid="ticket-info-status-take"
              onClick={() => {
                ticketInfoDirtyFields = ticketInfoDirtyFields.filter((field) => field !== 'status_id');
                delete ticketInfoLocalFieldValues.status_id;
                onTakeLiveConflict?.('status_id');
                onLiveDirtyFieldsChange?.(ticketInfoDirtyFields);
              }}
            >
              Take theirs
            </button>
          </>
        ) : null}
        <div
          data-testid="ticket-info-priority"
          data-priority={displayedPriority}
          data-live-highlighted={liveHighlightedFields.includes('priority_id') ? 'true' : undefined}
          data-live-conflict={liveFieldConflicts.priority_id ? 'true' : undefined}
        />
      </div>
    );
  },
}));

vi.mock('../TicketProperties', () => ({
  __esModule: true,
  default: function TicketPropertiesMock({
    onLiveDirtyFieldsChange,
  }: {
    onLiveDirtyFieldsChange?: (fields: string[]) => void;
  }) {
    React.useEffect(() => {
      onLiveDirtyFieldsChange?.(ticketPropertiesDirtyFields);
      return () => onLiveDirtyFieldsChange?.([]);
    }, [onLiveDirtyFieldsChange]);

    return <div data-testid="ticket-properties" />;
  },
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

const baseTicket = {
  ticket_id: 'ticket-1',
  ticket_number: 'T-001',
  title: 'Test Ticket',
  tenant: 'tenant-1',
  board_id: 'board-1',
  client_id: 'client-1',
  contact_name_id: null,
  status_id: 'status-1',
  priority_id: 'priority-1',
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

const enabledBoard = {
  board_id: 'board-1',
  board_name: 'Enabled Board',
  enable_live_ticket_timer: true,
};

function renderTicketDetails() {
  return render(
    <TicketDetails
      initialTicket={baseTicket}
      initialBoard={enabledBoard}
      statusOptions={[
        { value: 'status-1', label: 'New' },
        { value: 'status-2', label: 'Resolved' },
      ]}
      priorityOptions={[
        { value: 'priority-1', label: 'Low' },
        { value: 'priority-2', label: 'High' },
      ]}
      boardOptions={[{ value: 'board-1', label: 'Support' }]}
    />
  );
}

describe('TicketDetails remote live updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ticketInfoDirtyFields = [];
    ticketPropertiesDirtyFields = [];
    ticketInfoLocalFieldValues = {};
    liveTicketContext = {
      enabled: true,
      presence: [],
      connectionStatus: 'connected',
      setEditingField: vi.fn(),
      lastRemoteUpdate: null,
      reconnectVersion: 0,
    };
    findBoardByIdMock.mockResolvedValue(enabledBoard);
    getTicketByIdMock.mockResolvedValue(baseTicket);
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('T034: no-overlap remote updates refetch silently and highlight the changed field', async () => {
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      status_id: 'status-2',
      updated_at: '2026-05-08T12:00:00.000Z',
    });

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(getTicketByIdMock).toHaveBeenCalledWith('ticket-1');
    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-status', 'status-2');
    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-live-highlighted', 'true');
    expect(toastSuccessMock).not.toHaveBeenCalled();

  });

  it('T035: bursts of remote messages collapse into a single refetch', async () => {
    const view = renderTicketDetails();

    for (let index = 0; index < 5; index += 1) {
      liveTicketContext = {
        ...liveTicketContext,
        lastRemoteUpdate: {
          updatedFields: ['status_id'],
          updatedBy: { userId: `user-${index + 2}`, displayName: `User ${index + 2}` },
          updatedAt: `2026-05-08T12:00:0${index}.000Z`,
        },
      };

      act(() => {
        view.rerender(
          <TicketDetails
            initialTicket={baseTicket}
            initialBoard={enabledBoard}
            statusOptions={[
              { value: 'status-1', label: 'New' },
              { value: 'status-2', label: 'Resolved' },
            ]}
            priorityOptions={[
              { value: 'priority-1', label: 'Low' },
              { value: 'priority-2', label: 'High' },
            ]}
            boardOptions={[{ value: 'board-1', label: 'Support' }]}
          />
        );
      });
    }
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(getTicketByIdMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(getTicketByIdMock).toHaveBeenCalledTimes(1);
  });

  it('T036: non-overlapping unsaved local changes preserve the local field and show a toast', async () => {
    ticketInfoDirtyFields = ['priority_id'];
    ticketInfoLocalFieldValues = { priority_id: 'priority-local' };
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      status_id: 'status-2',
      updated_at: '2026-05-08T12:00:00.000Z',
    });

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-status', 'status-2');
    expect(screen.getByTestId('ticket-info-priority')).toHaveAttribute('data-priority', 'priority-local');
    expect(toastSuccessMock).toHaveBeenCalledWith('Bob updated status');
    expect(screen.getByTestId('ticket-info-status')).not.toHaveAttribute('data-live-conflict');
  });

  it('T037: same-field overlap freezes the field and shows the conflict banner state', async () => {
    ticketInfoDirtyFields = ['status_id'];
    ticketInfoLocalFieldValues = { status_id: 'status-local' };
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      status_id: 'status-2',
      updated_at: '2026-05-08T12:00:00.000Z',
    });

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-status', 'status-local');
    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-live-conflict', 'true');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('T038: Keep yours clears the banner and retains the local pending value without another save', async () => {
    ticketInfoDirtyFields = ['status_id'];
    ticketInfoLocalFieldValues = { status_id: 'status-local' };
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      status_id: 'status-2',
      updated_at: '2026-05-08T12:00:00.000Z',
    });

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    act(() => {
      screen.getByTestId('ticket-info-status-keep').click();
    });

    expect(screen.getByTestId('ticket-info-status')).not.toHaveAttribute('data-live-conflict');
    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-status', 'status-local');
    expect(getTicketByIdMock).toHaveBeenCalledTimes(1);
  });

  it('T039: Take theirs clears the banner, drops the local pending value, and shows the refetched field', async () => {
    ticketInfoDirtyFields = ['status_id'];
    ticketInfoLocalFieldValues = { status_id: 'status-local' };
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      status_id: 'status-2',
      updated_at: '2026-05-08T12:00:00.000Z',
    });

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    act(() => {
      screen.getByTestId('ticket-info-status-take').click();
    });

    expect(screen.getByTestId('ticket-info-status')).not.toHaveAttribute('data-live-conflict');
    expect(screen.getByTestId('ticket-info-status')).toHaveAttribute('data-status', 'status-2');
  });

  it('T044: refetch failures that look like access loss redirect away from the ticket', async () => {
    getTicketByIdMock.mockRejectedValue(new Error('403'));

    const view = renderTicketDetails();

    liveTicketContext = {
      ...liveTicketContext,
      lastRemoteUpdate: {
        updatedFields: ['status_id'],
        updatedBy: { userId: 'user-2', displayName: 'Bob' },
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    };

    act(() => {
      view.rerender(
        <TicketDetails
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          statusOptions={[
            { value: 'status-1', label: 'New' },
            { value: 'status-2', label: 'Resolved' },
          ]}
          priorityOptions={[
            { value: 'priority-1', label: 'Low' },
            { value: 'priority-2', label: 'High' },
          ]}
          boardOptions={[{ value: 'board-1', label: 'Support' }]}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
    });

    expect(routerPushMock).toHaveBeenCalledWith('/msp/tickets');
  });
});

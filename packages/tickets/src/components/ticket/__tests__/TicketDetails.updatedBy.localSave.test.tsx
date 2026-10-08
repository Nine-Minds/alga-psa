/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const {
  routerPushMock,
  findBoardByIdMock,
  getTicketByIdMock,
  toastSuccessMock,
  toastErrorMock,
  getDocumentsMock,
} = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  findBoardByIdMock: vi.fn(),
  getTicketByIdMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  getDocumentsMock: vi.fn().mockResolvedValue([]),
}));
let conversationProps: any;

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

const sessionRef = vi.hoisted(() => ({
  current: { user: { id: 'user-1', name: 'Sam Session', email: 'sam@example.com' } } as null | { user: { id: string; name: string; email: string } },
}));

vi.mock('next/navigation', () => {
  // A fresh router on each render would reset the remote-update debounce.
  const router = { push: routerPushMock, refresh: vi.fn() };
  return {
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/msp/tickets/ticket-1',
  };
});

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: sessionRef.current }),
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
      getDocumentByTicketId: getDocumentsMock,
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

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Keep t stable like the provider; replacing it on every render requeues the
  // remote-update debounce while asynchronous mount effects are settling.
  const translate = (_key: string, fallback?: string | Record<string, unknown>) => {
    // Mirror i18next's t(key, options): defaultValue plus {{var}} interpolation.
    if (fallback && typeof fallback === 'object') {
      const options = fallback;
      const template = typeof options.defaultValue === 'string' ? options.defaultValue : _key;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name] ?? ''));
    }
    return typeof fallback === 'string' ? fallback : _key;
  };
  return {
    // Components under test format dates through useFormatters; the real hook
    // reads the locale off the provider this test does not mount.
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
      t: translate,
    }),
  };
});

vi.mock('@alga-psa/tags/context', () => ({
  useTags: () => ({ tags: [] }),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
  // fetchTags() guards its result with this; omitting it made every tag load
  // throw and get swallowed, so the component's tag path was never exercised.
  isTagActionError: () => false,
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

vi.mock('../../../actions/comment-actions/commentActions', () => ({
  findCommentsByTicketId: vi.fn().mockResolvedValue([]),
  deleteComment: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  findCommentById: vi.fn(),
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
    .mockResolvedValue({ showWeekday: false, responseStateTrackingEnabled: true }),
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

vi.mock('../bento/TicketBentoLayout', () => ({
  __esModule: true,
  default: ({ onBatchSelectChange }: { onBatchSelectChange?: (changes: Record<string, unknown>) => Promise<boolean> }) => (
    <button
      type="button"
      data-testid="change-priority"
      onClick={() => onBatchSelectChange?.({ priority_id: 'priority-2' })}
    />
  ),
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
  default: ({ initialDocuments }: any) => <div data-testid="ticket-documents">{JSON.stringify(initialDocuments)}</div>,
}));

vi.mock('../TicketEmailNotifications', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-email-notifications" />,
}));

vi.mock('../TicketConversation', () => ({
  __esModule: true,
  default: (props: any) => {
    conversationProps = props;
    return <div data-testid="ticket-conversation" />;
  },
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

// Full-page mount uses the Grid (bento) layout; its batch "Save Changes" is the repro path.
const gridLayoutBootstrap = { ...entryLayoutBootstrap, layoutPreference: { layout: 'grid', timelineOrder: 'asc' } } as typeof entryLayoutBootstrap;

function renderTicketDetails(extraProps: Partial<React.ComponentProps<typeof TicketDetails>> = {}) {
  return render(
    <TicketDetails
      bootstrap={gridLayoutBootstrap}
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
      {...extraProps}
    />
  );
}

describe('TicketDetails "Updated … by" after a local save without a currentUser prop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentsMock.mockResolvedValue([]);
    ticketInfoDirtyFields = [];
    ticketPropertiesDirtyFields = [];
    ticketInfoLocalFieldValues = {};
    findBoardByIdMock.mockResolvedValue(enabledBoard);
    getTicketByIdMock.mockResolvedValue(baseTicket);
  });

  afterEach(() => {
    cleanup();
    sessionRef.current = { user: { id: 'user-1', name: 'Sam Session', email: 'sam@example.com' } };
  });

  it('names the session user in the header after a local save (full-page mount)', async () => {
    await act(async () => { renderTicketDetails({ onBatchTicketUpdate: vi.fn().mockResolvedValue(true) }); });
    // Server never recorded an updater: the plain label, no name.
    expect(screen.getByTestId('ticket-updated-at').textContent).not.toContain(' by ');

    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    expect(screen.getByTestId('ticket-updated-at')).toHaveTextContent(/by Sam Session$/);
  });

  it('lets an explicit currentUser (drawer) take precedence over the session', async () => {
    await act(async () => {
      renderTicketDetails({
        onBatchTicketUpdate: vi.fn().mockResolvedValue(true),
        currentUser: { user_id: 'user-9', first_name: 'Dana', last_name: 'Drawer', email: 'd@example.com' } as any,
      });
    });
    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    expect(screen.getByTestId('ticket-updated-at')).toHaveTextContent(/by Dana Drawer$/);
  });

  it('names currentUser and bumps the time after a drawer-style save (no onBatchTicketUpdate)', async () => {
    const staleTicket = { ...baseTicket, updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'user-5' };
    await act(async () => {
      renderTicketDetails({
        initialTicket: staleTicket,
        initialUpdatedByUser: { user_id: 'user-5', first_name: 'Old', last_name: 'Updater', email: 'o@example.com' } as any,
        currentUser: { user_id: 'user-9', first_name: 'Dana', last_name: 'Drawer', email: 'd@example.com' } as any,
      });
    });
    const before = screen.getByTestId('ticket-updated-at').textContent;
    expect(before).toMatch(/by Old Updater$/);

    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    const after = screen.getByTestId('ticket-updated-at').textContent;
    expect(after).toMatch(/by Dana Drawer$/);
    expect(after).not.toBe(before);
    expect(after).not.toContain('2020');
  });

  it('does not restamp the header when the per-field write fails', async () => {
    const { updateTicket } = await import('../../../actions/ticketActions');
    vi.mocked(updateTicket).mockResolvedValueOnce('failure' as any);
    await act(async () => {
      renderTicketDetails({
        initialUpdatedByUser: { user_id: 'user-5', first_name: 'Old', last_name: 'Updater', email: 'o@example.com' } as any,
        currentUser: { user_id: 'user-9', first_name: 'Dana', last_name: 'Drawer', email: 'd@example.com' } as any,
      });
    });
    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    expect(screen.getByTestId('ticket-updated-at')).toHaveTextContent(/by Old Updater$/);
  });

  it('uses the session user when the session resolves after the first render (no stale null actor)', async () => {
    const sessionUser = { user: { id: 'user-1', name: 'Sam Session', email: 'sam@example.com' } };
    sessionRef.current = null;
    const onBatchTicketUpdate = vi.fn().mockResolvedValue(true);
    const view = render(
      <TicketDetails
        bootstrap={gridLayoutBootstrap}
        initialTicket={baseTicket}
        initialBoard={enabledBoard}
        priorityOptions={[{ value: 'priority-1', label: 'Low' }, { value: 'priority-2', label: 'High' }]}
        onBatchTicketUpdate={onBatchTicketUpdate}
      />
    );
    await act(async () => {});

    sessionRef.current = sessionUser;
    await act(async () => {
      view.rerender(
        <TicketDetails
          bootstrap={gridLayoutBootstrap}
          initialTicket={baseTicket}
          initialBoard={enabledBoard}
          priorityOptions={[{ value: 'priority-1', label: 'Low' }, { value: 'priority-2', label: 'High' }]}
          onBatchTicketUpdate={onBatchTicketUpdate}
        />
      );
    });

    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });
    expect(screen.getByTestId('ticket-updated-at')).toHaveTextContent(/by Sam Session$/);
  });
});

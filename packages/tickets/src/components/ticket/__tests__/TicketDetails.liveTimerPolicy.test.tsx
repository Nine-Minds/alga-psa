/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDetails from '../TicketDetails';

const findBoardByIdMock = vi.fn();
const onTicketUpdateMock = vi.fn();
const startTrackingMock = vi.fn();
const stopTrackingMock = vi.fn();
const refreshLockStateMock = vi.fn();
const openDrawerMock = vi.fn();
const closeDrawerMock = vi.fn();
const replaceDrawerMock = vi.fn();
const launchTimeEntryMock = vi.fn();
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer: openDrawerMock,
    closeDrawer: closeDrawerMock,
    replaceDrawer: replaceDrawerMock,
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({
    launchTimeEntry: launchTimeEntryMock,
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
  useTicketTimeTracking: () => ({
    isTracking: false,
    currentIntervalId: null,
    isLockedByOther: false,
    startTracking: startTrackingMock,
    stopTracking: stopTrackingMock,
    refreshLockState: refreshLockStateMock,
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
    t: (_key: string, fallback?: string) => fallback ?? _key,
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
  getContactByContactNameId: vi.fn().mockResolvedValue(null),
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientById: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../actions/optimizedTicketActions', () => ({
  updateTicketWithCache: vi.fn(),
}));

vi.mock('../../../actions/ticketActions', () => ({
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
  default: ({ onSelectChange }: { onSelectChange?: (field: string, value: string) => Promise<void> }) => (
    <button type="button" onClick={() => onSelectChange?.('board_id', 'board-disabled')}>
      Move to disabled board
    </button>
  ),
}));

vi.mock('../TicketProperties', () => ({
  __esModule: true,
  default: ({ isLiveTicketTimerEnabled }: { isLiveTicketTimerEnabled: boolean }) => (
    <div data-testid="live-timer-enabled">{String(isLiveTicketTimerEnabled)}</div>
  ),
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

const disabledBoard = {
  board_id: 'board-disabled',
  board_name: 'Disabled Board',
  enable_live_ticket_timer: false,
};

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('TicketDetails live timer board policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBoardByIdMock.mockImplementation(async (boardId: string | null) => {
      if (boardId === 'board-disabled') {
        return disabledBoard;
      }

      if (boardId === 'board-1') {
        return enabledBoard;
      }

      return null;
    });
    onTicketUpdateMock.mockReset();
    startTrackingMock.mockResolvedValue(false);
    stopTrackingMock.mockResolvedValue(undefined);
    refreshLockStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  it('skips live timer auto-start when the initial board disables the live timer', async () => {
    render(
      <TicketDetails
        initialTicket={{ ...baseTicket, board_id: 'board-disabled' }}
        initialBoard={disabledBoard}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('false');
    });

    expect(startTrackingMock).not.toHaveBeenCalled();
  });

  it('applies the destination board timer policy only after the board update saves', async () => {
    const updateGate = deferredPromise<void>();
    onTicketUpdateMock.mockImplementation(() => updateGate.promise);

    render(
      <TicketDetails
        initialTicket={baseTicket}
        initialBoard={enabledBoard}
        onTicketUpdate={onTicketUpdateMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move to disabled board' }));

    await waitFor(() => {
      expect(onTicketUpdateMock).toHaveBeenCalledWith('board_id', 'board-disabled');
    });

    expect(findBoardByIdMock).not.toHaveBeenCalledWith('board-disabled');
    expect(stopTrackingMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('true');

    updateGate.resolve();

    await waitFor(() => {
      expect(findBoardByIdMock).toHaveBeenCalledWith('board-disabled');
    });
    await waitFor(() => {
      expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('false');
    });
    await waitFor(() => {
      expect(stopTrackingMock).toHaveBeenCalled();
    });
  });

  it('keeps the live timer enabled when the board update fails', async () => {
    onTicketUpdateMock.mockRejectedValue(new Error('save failed'));

    render(
      <TicketDetails
        initialTicket={baseTicket}
        initialBoard={enabledBoard}
        onTicketUpdate={onTicketUpdateMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move to disabled board' }));

    await waitFor(() => {
      expect(onTicketUpdateMock).toHaveBeenCalledWith('board_id', 'board-disabled');
    });

    await waitFor(() => {
      expect(screen.getByTestId('live-timer-enabled')).toHaveTextContent('true');
    });

    expect(findBoardByIdMock).not.toHaveBeenCalledWith('board-disabled');
    expect(stopTrackingMock).not.toHaveBeenCalled();
  });
});

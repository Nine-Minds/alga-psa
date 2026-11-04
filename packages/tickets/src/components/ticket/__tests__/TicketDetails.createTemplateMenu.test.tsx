/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const checkTicketClosureMock = vi.fn();
const updateCommentMock = vi.fn();
const findCommentByIdMock = vi.fn();
const { launchTimeEntryMock, stopwatchRef, templatePermsRef, pushMock } = vi.hoisted(() => ({
  templatePermsRef: { current: { read: true, create: false, update: false, delete: false, loaded: true } },
  pushMock: vi.fn(),
  launchTimeEntryMock: vi.fn(),
  stopwatchRef: { current: null as any },
}));
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
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-1',
}));

vi.mock('../../templates/useTicketTemplatePermissions', () => ({
  useTicketTemplatePermissions: () => templatePermsRef.current,
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
  useStopwatch: () => stopwatchRef.current,
  useStopwatchElapsedMs: () => 90_000,
  formatStopwatchClock: () => '00:01:30',
  formatStopwatchDuration: () => '1m',
  useSchedulingCallbacks: () => ({
    launchTimeEntry: launchTimeEntryMock,
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

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id }),
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
vi.mock('../TicketProperties', async () => {
  const { TicketStopwatchControls } = await import('../TicketStopwatchControls');
  return {
    __esModule: true,
    default: (props: any) => (
      <TicketStopwatchControls
        id="props"
        ticketId={props.ticket.ticket_id}
        enabled={props.isLiveTicketTimerEnabled ?? true}
        timeDescription={props.timeDescription}
        onTimeDescriptionChange={props.onTimeDescriptionChange}
        onTimeEntryLogged={props.onTimeEntryLogged}
      />
    ),
  };
});
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

vi.mock('../TicketConversation', () => ({ __esModule: true, default: () => <div data-testid="ticket-conversation" /> }));

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

const statusOptions = [{ value: 'status-open', label: 'Open', is_closed: false, board_id: 'board-1' }];
const board = { board_id: 'board-1', board_name: 'Board', enable_live_ticket_timer: true };

const session = {
  session_id: 'session-1',
  user_id: 'user-1',
  work_item_type: 'ticket',
  work_item_id: 'ticket-1',
  service_id: null,
  notes: '',
  status: 'running',
  time_entry_id: null,
  closed_at: null,
  created_at: '2026-09-09T10:00:00Z',
  updated_at: '2026-09-09T10:00:00Z',
  segments: [{ segment_id: 'g1', started_at: '2026-09-09T10:00:00Z', ended_at: null }],
  active_ms: 90_000,
  server_now: '2026-09-09T10:01:30Z',
  ticket_number: 'T-001',
  work_item_title: 'Test Ticket',
  project_name: null,
  client_name: 'Acme',
  service_name: null,
} as any;

const span = {
  start: new Date('2026-09-09T10:00:00Z'),
  end: new Date('2026-09-09T10:15:00Z'),
  billableMinutes: 15,
  pausedMs: 0,
  segmentCount: 1,
};

function makeStopwatch(current: any) {
  const value = {
    session: current,
    state: current ? current.status : 'idle',
    isLoading: false,
    serverOffsetMs: 0,
    getElapsedMs: () => 90_000,
    getEntrySpan: () => span,
    start: vi.fn().mockResolvedValue({ status: 'started', session }),
    pause: vi.fn(),
    resume: vi.fn(),
    requestStop: vi.fn(async (launcher: any) => {
      await launcher({ session: current, span, onLogged: vi.fn() });
      return { status: 'ok' };
    }),
    requestDiscard: vi.fn(),
    updateNotes: vi.fn(),
    refresh: vi.fn(),
  };
  stopwatchRef.current = value;
  return value;
}

function renderDetails() {
  return render(
    <TicketDetails
      bootstrap={entryLayoutBootstrap}
      initialTicket={baseTicket}
      initialBoard={board}
      initialComments={[]}
      statusOptions={statusOptions}
    />,
  );
}

describe('TicketDetails "Create template from ticket" menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBoardByIdMock.mockResolvedValue(board);
    getTicketByIdMock.mockResolvedValue(baseTicket);
    checkTicketClosureMock.mockResolvedValue({ wouldClose: false, allowed: true, failures: [], canOverride: false });
    makeStopwatch(null);
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  const moreButton = () => document.querySelector('[id$="-more-actions-button"]') as HTMLElement | null;
  const duplicateOrDelete = () => document.querySelector('[id$="-delete-ticket-button"]');

  it('renders the More menu and its item when ticket_template:create is granted, and routes to the editor', async () => {
    templatePermsRef.current = { read: true, create: true, update: true, delete: true, loaded: true };
    renderDetails();
    await waitFor(() => expect(moreButton()).not.toBeNull());

    await userEvent.click(moreButton() as HTMLElement);
    const item = await waitFor(() => {
      const el = document.querySelector('[id$="-create-template-menu-item"]') as HTMLElement | null;
      if (!el) throw new Error('menu item not rendered');
      return el;
    });
    expect(item).toHaveTextContent('Create template from ticket');

    await userEvent.click(item);
    expect(pushMock).toHaveBeenCalledWith('/msp/tickets/templates/new?fromTicket=ticket-1');
  });

  it.each([
    ['read only (Technician)', { read: true, create: false, update: false, delete: false, loaded: true }],
    ['not yet resolved', { read: false, create: false, update: false, delete: false, loaded: false }],
  ])('leaves Create template out of the More menu when %s', async (_label, perms) => {
    templatePermsRef.current = perms;
    renderDetails();
    // The More menu always exists: it also holds Print work tag, Duplicate and Delete.
    await waitFor(() => expect(moreButton()).not.toBeNull());
    await userEvent.click(moreButton() as HTMLElement);
    await waitFor(() => expect(duplicateOrDelete()).not.toBeNull());
    expect(document.querySelector('[id$="-create-template-menu-item"]')).toBeNull();
  });
});

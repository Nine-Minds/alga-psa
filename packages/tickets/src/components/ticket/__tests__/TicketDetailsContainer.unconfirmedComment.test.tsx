/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * A comment whose publish is not confirmed (a returned action error, or an
 * unknown outcome after the server may already have stored it) must leave the
 * composer open with the author's draft, so the same intent can be retried.
 * Drives the real container and ticket screen; only the rich-text composer is
 * a probe that behaves like TicketConversation (closes only on success).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDetailsContainer from '../TicketDetailsContainer';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const { addCommentMock, findCommentsMock, toastMock, handleErrorMock, launchTimeEntryMock } = vi.hoisted(() => ({
  addCommentMock: vi.fn(),
  findCommentsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  handleErrorMock: vi.fn(),
  launchTimeEntryMock: vi.fn(),
}));
const checkTicketClosureMock = vi.fn();
const updateCommentMock = vi.fn();
const findCommentByIdMock = vi.fn();
const updateTicketMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();
const findBoardByIdMock = vi.fn();
const getTicketByIdMock = vi.fn();
const previewBundlePropagationMock = vi.fn();
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/ticket-1',
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('react-hot-toast', () => ({
  toast: toastMock,
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

vi.mock('@alga-psa/ui/lib/errorHandling', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/ui/lib/errorHandling')>('@alga-psa/ui/lib/errorHandling');
  return { ...actual, handleError: handleErrorMock };
});

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), replaceDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useStopwatch: () => null,
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
  findCommentsByTicketId: (...args: unknown[]) => findCommentsMock(...args),
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
  findCommentsByTicketId: (...args: unknown[]) => findCommentsMock(...args),
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
  addTicketCommentWithCache: vi.fn(),
  addTicketCommentWithCacheForCurrentUser: (...args: unknown[]) => addCommentMock(...args),
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
// The real section starts an external-links fetch that outlives the test and logs after the worker is torn down
// ("Closing rpc while onUserConsoleLog was pending"); like its sibling sections it is not under test here.
vi.mock('../TicketExternalLinksSection', () => {
  const TicketExternalLinksSection = () => <div data-testid="ticket-external-links" />;
  return { __esModule: true, TicketExternalLinksSection, default: TicketExternalLinksSection };
});
vi.mock('../AgentScheduleDrawer', () => ({ __esModule: true, default: () => <div data-testid="agent-schedule" /> }));
vi.mock('../TicketNavigation', () => ({ __esModule: true, default: () => <div data-testid="ticket-navigation" /> }));
vi.mock('../TicketResolutionDialog', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketLiveProvider', () => ({
  TicketLiveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock('../TicketConversation', () => ({
  __esModule: true,
  default: function ComposerProbe(props: any) {
    const [open, setOpen] = React.useState(true);
    const [outcome, setOutcome] = React.useState('');
    if (!open) return <div data-testid="composer-closed" />;
    return (
      <div>
        <textarea
          key={props.editorKey}
          aria-label="Comment draft"
          onChange={(event) =>
            props.onNewCommentContentChange([
              { type: 'paragraph', content: [{ type: 'text', text: event.target.value, styles: {} }] },
            ])
          }
        />
        <span data-testid="draft-generation">{String(props.editorKey)}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await props.onAddNewComment(false, false, null);
            setOutcome(String(ok));
            if (ok) setOpen(false);
          }}
        >
          Publish
        </button>
        <span data-testid="outcome">{outcome}</span>
      </div>
    );
  },
}));

const ticket = {
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
const board = { board_id: 'board-1', board_name: 'Board' };

function renderScreen() {
  return render(
    <TicketDetailsContainer
      bootstrap={entryLayoutBootstrap}
      ticketData={{
        ticket,
        comments: [],
        documents: [],
        client: null,
        contacts: [],
        contactInfo: null,
        createdByUser: null,
        board,
        additionalAgents: [],
        availableAgents: [],
        userMap: {},
        options: { status: [{ value: 'status-open', label: 'Open', is_closed: false, board_id: 'board-1' }], agent: [], board: [], priority: [] },
        categories: [],
        clients: [],
        locations: [],
        agentSchedules: [],
      } as any}
    />,
  );
}

async function typeAndPublish(text: string) {
  fireEvent.change(await screen.findByLabelText('Comment draft'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
}

describe('TicketDetailsContainer unconfirmed comment publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBoardByIdMock.mockResolvedValue(board);
    getTicketByIdMock.mockResolvedValue(ticket);
    findCommentsMock.mockResolvedValue([]);
    checkTicketClosureMock.mockResolvedValue({ wouldClose: false, allowed: true, failures: [], canOverride: false });
  });
  afterEach(() => cleanup());

  it('keeps the composer and draft when the publish outcome is unknown, then retries the same text', async () => {
    const unknown = 'We could not confirm whether the message was saved. Retry to check the same request.';
    addCommentMock.mockResolvedValueOnce({ actionError: unknown });
    renderScreen();
    await typeAndPublish('Uncertain message');

    await waitFor(() => expect(screen.getByTestId('outcome')).toHaveTextContent('false'));
    expect(toastMock.error).toHaveBeenCalledWith(unknown);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.queryByTestId('composer-closed')).toBeNull();
    // The editor was not remounted, so the typed text is still on screen.
    expect(screen.getByTestId('draft-generation')).toHaveTextContent('0');
    expect(screen.getByLabelText('Comment draft')).toHaveValue('Uncertain message');
    expect(findCommentsMock).not.toHaveBeenCalled();

    // Retrying submits the same retained intent; a confirmation then closes and clears it.
    addCommentMock.mockResolvedValueOnce({ comment_id: 'comment-1', note: 'x' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(screen.getByTestId('composer-closed')).toBeInTheDocument());
    expect(addCommentMock).toHaveBeenCalledTimes(2);
    expect(addCommentMock.mock.calls[1][1]).toBe(addCommentMock.mock.calls[0][1]);
    expect(JSON.parse(addCommentMock.mock.calls[1][1])[0].content[0].text).toBe('Uncertain message');
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer when the publish request itself throws', async () => {
    addCommentMock.mockRejectedValueOnce(new Error('network dropped'));
    renderScreen();
    await typeAndPublish('Dropped message');

    await waitFor(() => expect(screen.getByTestId('outcome')).toHaveTextContent('false'));
    expect(handleErrorMock).toHaveBeenCalled();
    expect(screen.getByLabelText('Comment draft')).toHaveValue('Dropped message');
    expect(screen.getByTestId('draft-generation')).toHaveTextContent('0');
  });
});

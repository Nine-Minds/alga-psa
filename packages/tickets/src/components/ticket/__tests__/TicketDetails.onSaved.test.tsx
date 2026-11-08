/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';

const checkTicketClosureMock = vi.fn();
const deleteTicketMock = vi.fn();
const addTicketResourceMock = vi.fn();
const addTicketCommentWithCacheMock = vi.fn();
const closeDrawerMock = vi.fn();
const callOrder: string[] = [];
let resolutionConfirm: ((...args: any[]) => Promise<boolean>) | null = null;
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
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: closeDrawerMock, replaceDrawer: vi.fn() }),
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
  addTicketResource: (...args: unknown[]) => addTicketResourceMock(...args),
  getTicketResources: vi.fn().mockResolvedValue([]),
  removeTicketResource: vi.fn(),
  assignTeamToTicket: vi.fn().mockResolvedValue(undefined),
  removeTeamFromTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../actions/ticketResourceActions', () => ({
  addTicketResource: (...args: unknown[]) => addTicketResourceMock(...args),
  getTicketResources: vi.fn().mockResolvedValue([]),
  removeTicketResource: vi.fn(),
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
  addTicketCommentWithCache: (...args: unknown[]) => addTicketCommentWithCacheMock(...args),
}));

vi.mock('../../../actions/ticketActions', () => ({
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
  updateTicket: (...args: unknown[]) => updateTicketMock(...args),
  deleteTicket: (...args: unknown[]) => deleteTicketMock(...args),
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
vi.mock('../TicketProperties', () => ({
  __esModule: true,
  default: ({ onAddAgent }: { onAddAgent: (userId: string) => Promise<void> }) => (
    <button type="button" onClick={() => void onAddAgent('agent-1')}>
      add-agent
    </button>
  ),
}));
vi.mock('../TicketDocumentsSection', () => ({ __esModule: true, default: () => <div data-testid="ticket-documents" /> }));
vi.mock('../TicketEmailNotifications', () => ({ __esModule: true, default: () => <div data-testid="ticket-email" /> }));
vi.mock('../AgentScheduleDrawer', () => ({ __esModule: true, default: () => <div data-testid="agent-schedule" /> }));
vi.mock('../TicketNavigation', () => ({ __esModule: true, default: () => <div data-testid="ticket-navigation" /> }));
vi.mock('../TicketResolutionDialog', () => ({
  __esModule: true,
  default: ({ onConfirm }: { onConfirm: (...args: any[]) => Promise<boolean> }) => {
    resolutionConfirm = onConfirm;
    return null;
  },
}));
vi.mock('@alga-psa/ui/components/DeleteEntityDialog', () => ({
  DeleteEntityDialog: ({ isOpen, onConfirmDelete }: { isOpen: boolean; onConfirmDelete: () => void }) =>
    isOpen ? (
      <button type="button" onClick={() => void onConfirmDelete()}>
        confirm-delete
      </button>
    ) : null,
}));
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

const statusOptions = [
  { value: 'status-open', label: 'Open', is_closed: false, board_id: 'board-1' },
  { value: 'status-closed', label: 'Closed', is_closed: true, board_id: 'board-1' },
];

const board = { board_id: 'board-1', board_name: 'Board', enable_live_ticket_timer: false };
const noSuppression = { suppressContactNotifications: false, suppressInternalNotifications: false };

function renderDetails(props: Record<string, unknown> = {}) {
  const onSaved = vi.fn(() => { callOrder.push('onSaved'); });
  render(
    <TicketDetails
      bootstrap={entryLayoutBootstrap}
      initialTicket={baseTicket}
      initialBoard={board}
      initialComments={[]}
      statusOptions={statusOptions}
      onSaved={onSaved}
      {...props}
    />,
  );
  return onSaved;
}

const resolutionBlocks = [
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text: 'Replaced the failed switch.', styles: {} }],
  },
] as any[];

async function resolveAndClose(contentBlocks: any[] = resolutionBlocks) {
  await waitFor(() => expect(resolutionConfirm).toBeTruthy());
  let result: boolean | undefined;
  await act(async () => {
    result = await resolutionConfirm!('status-closed', contentBlocks, noSuppression, false);
  });
  return result;
}

describe('TicketDetails onSaved notifications (activity list refresh)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    resolutionConfirm = null;
    findBoardByIdMock.mockResolvedValue(board);
    getTicketByIdMock.mockResolvedValue(baseTicket);
    updateTicketMock.mockResolvedValue('success');
    updateTicketWithCacheMock.mockResolvedValue('success');
    addTicketCommentWithCacheMock.mockResolvedValue('success');
    addTicketResourceMock.mockResolvedValue({ assignment_id: 'as-1', assigned_to: 'agent-1' });
    deleteTicketMock.mockResolvedValue({ success: true });
    closeDrawerMock.mockImplementation(() => { callOrder.push('closeDrawer'); });
    previewBundlePropagationMock.mockResolvedValue({
      mode: 'sync_updates',
      masterTicketId: 'ticket-1',
      newStatusId: 'status-closed',
      crossesBoundary: null,
      affectedChildren: [],
      unaffectedChildren: [],
    });
    checkTicketClosureMock.mockResolvedValue({ wouldClose: true, allowed: true, failures: [], canOverride: false });
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  it('fires onSaved after a successful resolve-and-close', async () => {
    const onSaved = renderDetails();
    expect(await resolveAndClose()).toBe(true);
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith(
      'ticket-1',
      { status_id: 'status-closed' },
      expect.anything(),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('fires onSaved when the resolution comment saved but close rules blocked the status write', async () => {
    checkTicketClosureMock.mockResolvedValue({
      wouldClose: true,
      allowed: false,
      failures: [{ rule: 'checklist_incomplete', message: 'Checklist incomplete' }],
      canOverride: true,
    });
    const onSaved = renderDetails();
    expect(await resolveAndClose()).toBe(true);
    expect(updateTicketWithCacheMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not fire onSaved when the resolution comment itself failed to save', async () => {
    addTicketCommentWithCacheMock.mockRejectedValue(new Error('boom'));
    const onSaved = renderDetails();
    expect(await resolveAndClose()).toBe(false);
    expect(updateTicketWithCacheMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // A resolution is optional: an empty editor closes the ticket without
  // inserting a blank comment.
  it('closes without a comment when the resolution editor was left empty', async () => {
    const onSaved = renderDetails();
    expect(await resolveAndClose([])).toBe(true);
    expect(addTicketCommentWithCacheMock).not.toHaveBeenCalled();
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith(
      'ticket-1',
      { status_id: 'status-closed' },
      expect.anything(),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not fire onSaved when a no-comment close fails the status write', async () => {
    updateTicketWithCacheMock.mockRejectedValue(new Error('boom'));
    const onSaved = renderDetails();
    expect(await resolveAndClose([])).toBe(false);
    expect(addTicketCommentWithCacheMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  async function openDeleteAndConfirm() {
    // Delete is the last item of the header's More menu.
    const more = await waitFor(() => {
      const el = document.querySelector('[id$="-more-actions-button"]');
      if (!el) throw new Error('more actions button not rendered');
      return el as HTMLElement;
    });
    await userEvent.click(more);
    const button = await waitFor(() => {
      const el = document.querySelector('[id$="delete-ticket-button"]');
      if (!el) throw new Error('delete button not rendered');
      return el as HTMLElement;
    });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'confirm-delete' }));
  }

  it('fires onSaved before the drawer closes on a successful delete', async () => {
    const onClose = vi.fn(() => { callOrder.push('onClose'); });
    const onSaved = renderDetails({ isInDrawer: true, onClose });
    await openDeleteAndConfirm();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(callOrder.indexOf('onSaved')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('onSaved')).toBeLessThan(callOrder.indexOf('closeDrawer'));
    expect(callOrder.indexOf('onSaved')).toBeLessThan(callOrder.indexOf('onClose'));
  });

  it('does not fire onSaved or close the drawer when the delete is rejected', async () => {
    deleteTicketMock.mockResolvedValue({ success: false, canDelete: false, code: 'VALIDATION_FAILED', message: 'blocked', dependencies: [], alternatives: [] });
    const onClose = vi.fn();
    const onSaved = renderDetails({ isInDrawer: true, onClose });
    await openDeleteAndConfirm();

    await waitFor(() => expect(deleteTicketMock).toHaveBeenCalledWith('ticket-1'));
    await act(async () => {});
    expect(onSaved).not.toHaveBeenCalled();
    expect(closeDrawerMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires onSaved after a successful agent add', async () => {
    const onSaved = renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'add-agent' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(addTicketResourceMock).toHaveBeenCalledWith('ticket-1', 'agent-1', 'support');
  });

  it('does not fire onSaved when the agent add fails', async () => {
    addTicketResourceMock.mockRejectedValue(new Error('nope'));
    const onSaved = renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'add-agent' }));
    await waitFor(() => expect(addTicketResourceMock).toHaveBeenCalled());
    await act(async () => {});
    expect(onSaved).not.toHaveBeenCalled();
  });
});

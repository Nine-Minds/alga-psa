/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * T123 / T132 — F063/F067 of `ee/plans/2026-11-21-itil-remediation` (`impact-urgency`), screen side.
 *
 * An ITIL write is settled by the server in the same statement: Impact and Urgency derive the
 * priority (R4), and a direct priority change clears the assessment (D5). The ticket screen sends
 * neither of those settlements, so after such a save it re-reads the ticket instead of trusting
 * its own merge of what it sent — otherwise the form shows the old priority and "Not assessed"
 * until the page is reloaded.
 */

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

vi.mock('../bento/TicketBentoLayout', () => ({
  __esModule: true,
  // Grid shows the Created/Updated stamps in the hero, passed down as heroMeta.
  default: ({
    onBatchSelectChange,
    heroMeta,
  }: {
    onBatchSelectChange?: (changes: Record<string, unknown>) => Promise<boolean>;
    heroMeta?: React.ReactNode;
  }) => (
    <>
      <button
        type="button"
        data-testid="change-priority"
        onClick={() => onBatchSelectChange?.({ priority_id: 'priority-2' })}
      />
      {heroMeta}
    </>
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

vi.mock('../TicketInfo', () => ({
  __esModule: true,
  default: function TicketInfoMock({
    ticket,
    itilImpact,
    itilUrgency,
    onSaveChanges,
    onSelectChange,
    onItilFieldChange,
  }: {
    ticket: { priority_id?: string };
    itilImpact?: number;
    itilUrgency?: number;
    onSaveChanges?: (changes: Record<string, unknown>) => Promise<boolean>;
    onSelectChange: (field: string, value: string | null) => void;
    onItilFieldChange?: (field: 'itil_impact' | 'itil_urgency', value: number | null) => void;
  }) {
    return (
      <div>
        <div
          data-testid="ticket-info-assessment"
          data-impact={itilImpact ?? ''}
          data-urgency={itilUrgency ?? ''}
          data-priority={ticket.priority_id ?? ''}
        />
        <button
          type="button"
          data-testid="save-assessment"
          onClick={() => { void onSaveChanges?.({ itil_impact: 3, itil_urgency: 3 }); }}
        />
        <button
          type="button"
          data-testid="change-priority"
          onClick={() => { void onSelectChange('priority_id', 'priority-2'); }}
        />
        <button
          type="button"
          data-testid="change-impact"
          onClick={() => { void onItilFieldChange?.('itil_impact', 3); }}
        />
      </div>
    );
  },
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
  itil_impact: null,
  itil_urgency: null,
  entered_by: 'user-1',
  updated_by: 'user-1',
  closed_by: null,
  assigned_to: null,
  entered_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  url: null,
  attributes: {},
} as any;

const assessedTicket = { ...baseTicket, itil_impact: 2, itil_urgency: 2, priority_id: 'priority-2' };

const itilBoard = {
  board_id: 'board-1',
  board_name: 'ITIL Board',
  priority_type: 'itil',
  category_type: 'itil',
};

function renderTicketDetails(extraProps: Partial<React.ComponentProps<typeof TicketDetails>> = {}) {
  return render(
    <TicketDetails
      bootstrap={entryLayoutBootstrap}
      initialTicket={baseTicket}
      initialBoard={itilBoard as any}
      statusOptions={[{ value: 'status-1', label: 'New' }]}
      priorityOptions={[
        { value: 'priority-1', label: 'P3 - Medium', is_from_itil_standard: true },
        { value: 'priority-2', label: 'P2 - High', is_from_itil_standard: true },
      ]}
      boardOptions={[{ value: 'board-1', label: 'ITIL Board' }]}
      {...extraProps}
    />
  );
}

describe('TicketDetails re-reads an ITIL write the server settles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentsMock.mockResolvedValue([]);
    ticketInfoDirtyFields = [];
    ticketPropertiesDirtyFields = [];
    ticketInfoLocalFieldValues = {};
    findBoardByIdMock.mockResolvedValue(itilBoard);
    getTicketByIdMock.mockResolvedValue(baseTicket);
  });

  afterEach(() => {
    cleanup();
  });

  it('T132: a batch save of Impact and Urgency shows the assessment and the derived priority', async () => {
    // R4: the server writes the matrix priority in the same statement; the screen never sent it.
    getTicketByIdMock.mockResolvedValue({
      ...baseTicket,
      itil_impact: 3,
      itil_urgency: 3,
      priority_id: 'priority-2',
    });

    await act(async () => { renderTicketDetails({ onBatchTicketUpdate: vi.fn().mockResolvedValue(true) }); });
    expect(screen.getByTestId('ticket-info-assessment').getAttribute('data-impact')).toBe('');

    await act(async () => { fireEvent.click(screen.getByTestId('save-assessment')); });

    const assessment = screen.getByTestId('ticket-info-assessment');
    expect(assessment.getAttribute('data-impact')).toBe('3');
    expect(assessment.getAttribute('data-urgency')).toBe('3');
    expect(assessment.getAttribute('data-priority')).toBe('priority-2');
  });

  it('T123: a direct priority change on an assessed ticket shows the cleared assessment', async () => {
    // D5: the write clears Impact and Urgency, so the screen may not keep showing them.
    getTicketByIdMock.mockResolvedValue({
      ...assessedTicket,
      priority_id: 'priority-2',
      itil_impact: null,
      itil_urgency: null,
    });

    await act(async () => {
      renderTicketDetails({ initialTicket: { ...assessedTicket, priority_id: 'priority-1' } });
    });
    expect(screen.getByTestId('ticket-info-assessment').getAttribute('data-impact')).toBe('2');

    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    const assessment = screen.getByTestId('ticket-info-assessment');
    expect(assessment.getAttribute('data-impact')).toBe('');
    expect(assessment.getAttribute('data-urgency')).toBe('');
    expect(assessment.getAttribute('data-priority')).toBe('priority-2');
  });

  it('a priority change on a ticket with no assessment costs no extra read', async () => {
    await act(async () => { renderTicketDetails({ onBatchTicketUpdate: vi.fn().mockResolvedValue(true) }); });
    const readsBefore = getTicketByIdMock.mock.calls.length;

    await act(async () => { fireEvent.click(screen.getByTestId('change-priority')); });

    expect(getTicketByIdMock.mock.calls.length).toBe(readsBefore);
    expect(screen.getByTestId('ticket-info-assessment').getAttribute('data-priority')).toBe('priority-2');
  });

  it('a single ITIL field written on its own shows the derived priority', async () => {
    getTicketByIdMock.mockResolvedValue({
      ...assessedTicket,
      itil_impact: 3,
      itil_urgency: 2,
      priority_id: 'priority-2',
    });

    await act(async () => {
      renderTicketDetails({ initialTicket: { ...assessedTicket, priority_id: 'priority-1' } });
    });

    await act(async () => { fireEvent.click(screen.getByTestId('change-impact')); });

    const assessment = screen.getByTestId('ticket-info-assessment');
    expect(assessment.getAttribute('data-impact')).toBe('3');
    expect(assessment.getAttribute('data-priority')).toBe('priority-2');
  });
});

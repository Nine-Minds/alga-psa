/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import TicketDetails from '../TicketDetails';

let lastTicketInfoProps: any = null;

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } })
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentByTicketId: vi.fn().mockResolvedValue([]),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@alga-psa/core', () => ({
  utcToLocal: (value: string) => new Date(value),
  formatDateTime: () => 'formatted',
  getUserTimeZone: () => 'UTC',
  generateUUID: () => 'uuid-1',
}));

vi.mock('@alga-psa/tags/context', () => ({
  useTags: () => ({ tags: [] })
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../TicketInfo', () => ({
  default: (props: any) => {
    lastTicketInfoProps = props;
    return <div data-testid="ticket-info" />;
  },
}));
vi.mock('../TicketProperties', () => ({ default: () => <div data-testid="ticket-properties" /> }));
vi.mock('../TicketDocumentsSection', () => ({ default: () => <div data-testid="ticket-documents" /> }));
vi.mock('../TicketEmailNotifications', () => ({ default: () => <div data-testid="ticket-email-notifications" /> }));
vi.mock('../TicketConversation', () => ({ default: () => <div data-testid="ticket-conversation" /> }));
vi.mock('../AgentScheduleDrawer', () => ({ default: () => <div data-testid="agent-schedule" /> }));
vi.mock('../TicketNavigation', () => ({ default: () => <div data-testid="ticket-navigation" /> }));
vi.mock('../../TicketOriginBadge', () => ({ default: () => <div data-testid="ticket-origin" /> }));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    replaceDrawer: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({
    renderAgentSchedule: vi.fn(),
    launchTimeEntry: vi.fn(),
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
    startTracking: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionPermissionError: () => false,
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

vi.mock('@alga-psa/ui/components/BackNav', () => ({
  __esModule: true,
  default: () => <div data-testid="back-nav" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: vi.fn().mockResolvedValue({ dateTimeFormat: 'MMM d, yyyy h:mm a' })
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getCurrentUserPermissions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  findBoardById: vi.fn().mockResolvedValue(null),
  getAllBoards: vi.fn().mockResolvedValue([]),
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
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([]),
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamById: vi.fn().mockResolvedValue(null),
  getTeams: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentByTicketId: vi.fn().mockResolvedValue([])
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactByContactNameId: vi.fn().mockResolvedValue(null),
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientById: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([])
}));

vi.mock('../../actions/optimizedTicketActions', () => ({
  updateTicketWithCache: vi.fn()
}));

vi.mock('../../actions/ticketActions', () => ({
  updateTicket: vi.fn()
}));

vi.mock('../../actions/ticketBundleActions', () => ({
  addChildrenToBundleAction: vi.fn(),
  findTicketByNumberAction: vi.fn(),
  promoteBundleMasterAction: vi.fn(),
  removeChildFromBundleAction: vi.fn(),
  unbundleMasterTicketAction: vi.fn(),
  updateBundleSettingsAction: vi.fn(),
  searchEligibleChildTicketsAction: vi.fn()
}));

vi.mock('../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn().mockResolvedValue(undefined),
}));

describe('TicketDetails renderCreateProjectTask', () => {
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
    attributes: {}
  };

  it('renders renderCreateProjectTask button in header', () => {
    const renderCreateProjectTask = vi.fn();

    render(
      <TicketDetails
        initialTicket={baseTicket as any}
        renderCreateProjectTask={renderCreateProjectTask}
      />
    );

    expect(lastTicketInfoProps.renderProjectTaskActions).toBe(renderCreateProjectTask);
  });

  it('does not render create task button when renderCreateProjectTask is missing', () => {
    render(<TicketDetails initialTicket={baseTicket as any} />);

    expect(lastTicketInfoProps.renderProjectTaskActions).toBeUndefined();
  });
});

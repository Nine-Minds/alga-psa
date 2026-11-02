/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TicketDetails from '../TicketDetails';
import { entryLayoutBootstrap } from './entryLayoutBootstrap';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import {
  composeTicketDataSource,
  NATIVE_TICKET_CAPABILITIES,
  type TicketCapabilityKey,
} from '../../../lib/ticketDataSource';

let lastTicketInfoProps: any = null;

// The header shares one More menu with "Create template from ticket"; its gate is this hook.
const { templatePermsRef } = vi.hoisted(() => ({
  templatePermsRef: { current: { read: false, create: false, update: false, delete: false, loaded: true } },
}));

vi.mock('../../templates/useTicketTemplatePermissions', () => ({
  useTicketTemplatePermissions: () => templatePermsRef.current,
}));

// Radix menus open on pointer events jsdom does not model; render the content inline so the
// test exercises our wiring (gating + selection), not Radix.
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, id }: { children: React.ReactNode; onSelect?: () => void; id?: string }) => (
    <button type="button" id={id} onClick={() => onSelect?.()}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

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
let lastTicketPropertiesProps: any = null;
vi.mock('../TicketProperties', () => ({
  default: (props: any) => {
    lastTicketPropertiesProps = props;
    return <div data-testid="ticket-properties" />;
  },
}));
vi.mock('../TicketChecklistSection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: () => <div data-testid="checklist-section" />,
}));
vi.mock('../TicketCredentialsSection', () => ({ TicketCredentialsSection: () => <div data-testid="credentials-section" /> }));
vi.mock('../TicketExternalLinksSection', () => ({ TicketExternalLinksSection: () => <div data-testid="external-links-section" /> }));
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
    launchScheduleEntry: vi.fn(),
    fetchTimeEntriesForTicket: vi.fn(),
    deleteTimeEntry: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
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
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      // Mirror i18next's t(key, options) form where options carries defaultValue.
      if (fallback && typeof fallback === 'object') {
        fallback = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : undefined;
      }
      return typeof fallback === 'string' ? fallback : _key;
    },
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionPermissionError: () => false,
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
  default: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
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

vi.mock('../../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: vi.fn().mockResolvedValue({ showWeekday: false })
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
  isTagActionError: () => false,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getCurrentUserPermissions: vi.fn().mockResolvedValue([]),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
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
  isTeamActionError: () => false,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentByTicketId: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../actions/clientLookupActions', () => ({
  getClientLocations: vi.fn().mockResolvedValue([]),
  getContactByContactNameId: vi.fn().mockResolvedValue(null),
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientById: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../actions/optimizedTicketActions', () => ({
  updateTicketWithCache: vi.fn()
}));

vi.mock('../../../actions/ticketActions', () => ({
  updateTicket: vi.fn()
}));

vi.mock('../../../actions/ticketBundleActions', () => ({
  addChildrenToBundleAction: vi.fn(),
  findTicketByNumberAction: vi.fn(),
  promoteBundleMasterAction: vi.fn(),
  removeChildFromBundleAction: vi.fn(),
  unbundleMasterTicketAction: vi.fn(),
  updateBundleSettingsAction: vi.fn(),
  searchEligibleChildTicketsAction: vi.fn()
}));

vi.mock('../../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn().mockResolvedValue(undefined),
}));

// T002 (Entry layout half), mounted. Each capability is switched off on its
// own against the native set; the section it governs must disappear (or its
// handler / hide prop flip) while everything else stays as native.
const ticket = {
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
};

function renderEntry(off?: TicketCapabilityKey) {
  lastTicketInfoProps = null;
  lastTicketPropertiesProps = null;
  const dataSource = off
    ? composeTicketDataSource(nativeTicketDataSource, {
        capabilities: { ...NATIVE_TICKET_CAPABILITIES, [off]: false },
      })
    : nativeTicketDataSource;
  render(
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketDetails bootstrap={entryLayoutBootstrap as any} initialTicket={ticket as any} />
    </TicketDataSourceProvider>,
  );
}

/** What each capability governs in the mounted Entry layout: true when present. */
const PROBES: Array<[TicketCapabilityKey, () => boolean]> = [
  ['checklist', () => screen.queryByTestId('checklist-section') !== null],
  ['documents', () => screen.queryByTestId('ticket-documents') !== null],
  ['credentials', () => screen.queryByTestId('credentials-section') !== null],
  ['externalLinks', () => screen.queryByTestId('external-links-section') !== null],
  ['tags', () => typeof lastTicketInfoProps?.onTagsChange === 'function' && typeof lastTicketPropertiesProps?.onTagsChange === 'function'],
  ['activityLog', () => typeof lastTicketInfoProps?.onOpenActivityLog === 'function'],
  ['sla', () => lastTicketInfoProps?.hideSlaStatus !== true],
  ['timeEntry', () => lastTicketPropertiesProps?.hideTimeEntry !== true],
  ['materials', () => lastTicketPropertiesProps?.hideMaterials !== true],
  ['emailLogs', () => document.querySelector('[id$="-email-notification-logs-drawer"]') !== null],
  ['delete', () => document.querySelector('[id$="-delete-ticket-button"]') !== null],
];

describe('T002 TicketDetails Entry layout capability gates (mounted)', () => {
  beforeEach(() => {
    templatePermsRef.current = { read: false, create: false, update: false, delete: false, loaded: true };
  });

  it('native: every probed section is present', () => {
    renderEntry();
    for (const [key, present] of PROBES) {
      expect(present(), `${key} present for native`).toBe(true);
    }
  });

  it.each(PROBES.map(([key]) => [key]))('%s off removes only its own section', (key) => {
    renderEntry(key as TicketCapabilityKey);
    for (const [probeKey, present] of PROBES) {
      expect(present(), `${probeKey} with ${key} off`).toBe(probeKey !== key);
    }
    cleanup();
  });
});

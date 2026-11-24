import { beforeEach, describe, expect, it, vi } from 'vitest';


// Capability-gated reads of getConsolidatedTicketData: a read whose capability is off is not made.
// (Harness copied from optimizedTicketActions.sensitiveUsers.test.ts.)
// getConsolidatedTicketData must never return credential columns from `users`, anywhere in the
// bundle, and is an MSP-only view. The fake `users` table holds rows that CARRY hashed_password and
// two_factor_secret and, like a real database, honours `.select(...)`: a query with no select list
// (users.*) therefore returns the credentials, a projected query does not. The authorization kernel
// is REAL; only the DB, the comment model, avatars and the event/analytics plumbing are faked.

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getAllbyTicketIdMock = vi.fn();

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let usersQueries: Array<{ selected: string[] | null }>;
let queriedTables: string[];

function credentialRow(overrides: Row): Row {
  return {
    username: `${overrides.user_id}@example.test`,
    first_name: 'First',
    last_name: 'Last',
    email: `${overrides.user_id}@example.test`,
    tenant: 'tenant-1',
    is_inactive: false,
    user_type: 'internal',
    hashed_password: '$2b$10$not-a-real-hash',
    two_factor_secret: 'JBSWY3DPEHPK3PXP',
    two_factor_enabled: true,
    ...overrides,
  };
}

function makeBuilder(table: string) {
  const baseTable = table.split(' as ')[0];
  queriedTables.push(baseTable);
  const state: { selected: string[] | null; filters: Array<(row: Row) => boolean> } = {
    selected: null,
    filters: [],
  };
  if (baseTable === 'users') usersQueries.push(state);

  const resolveRows = (): Row[] => {
    const rows = (tables[baseTable] ?? []).filter((row) => state.filters.every((f) => f(row)));
    // Only `users` is projected; other tables return whole rows (their select lists use aliases/joins).
    if (baseTable !== 'users' || !state.selected || state.selected.length === 0) return rows;
    return rows.map((row) => {
      const projected: Row = {};
      for (const column of state.selected as string[]) {
        const key = column.replace(/^[a-z_]+\./, '');
        if (key in row) projected[key] = row[key];
      }
      return projected;
    });
  };

  const builder: any = new Proxy(function () {}, {
    get(_target, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: any, reject: any) => Promise.resolve(resolveRows()).then(resolve, reject);
      }
      if (prop === 'catch') return (reject: any) => Promise.resolve(resolveRows()).catch(reject);
      if (prop === 'first') return async () => resolveRows()[0];
      if (prop === 'select') {
        return (...cols: unknown[]) => {
          state.selected = [...(state.selected ?? []), ...cols.flat().map((col) => (typeof col === 'string' ? col : '[subquery]'))];
          return builder;
        };
      }
      if (prop === 'where') {
        return (arg: unknown, value?: unknown) => {
          if (arg && typeof arg === 'object') {
            for (const [k, v] of Object.entries(arg as Row)) {
              state.filters.push((row) => row[k.replace(/^[a-z_]+\./, '')] === v);
            }
          } else if (typeof arg === 'string' && value !== undefined) {
            state.filters.push((row) => row[arg.replace(/^[a-z_]+\./, '')] === value);
          }
          return builder;
        };
      }
      if (prop === 'whereIn') {
        return (column: string, values: unknown[]) => {
          state.filters.push((row) => values.includes(row[column.replace(/^[a-z_]+\./, '')]));
          return builder;
        };
      }
      return () => builder;
    },
  });
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
  checkMultiplePermissions: async (user: any, checks: Array<{ resource: string; action: string }>, conn?: unknown) =>
    Promise.all(checks.map(async (check) => ({ ...check, granted: Boolean(await hasPermissionMock(user, check.resource, check.action, conn)) }))),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => makeBuilder(table),
    unscoped: (table: string) => makeBuilder(table),
    tenantJoin: (builder: unknown) => builder,
    scoped: (table: string) => ({ tenant, builder: makeBuilder(table) }),
  }),
  registerAfterCommit: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('../models/comment', () => ({
  default: { getAllbyTicketId: (...args: any[]) => getAllbyTicketIdMock(...args) },
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(async () => null),
  getUserAvatarUrl: vi.fn(async () => null),
  getClientLogoUrlsBatch: vi.fn(async () => new Map()),
  getEntityImageUrlsBatch: vi.fn(async () => new Map()),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(async () => ({
    effectiveTicketScope: 'client',
    contactId: 'contact-own',
    clientId: 'client-own',
    visibleBoardIds: null,
  })),
}));

vi.mock('@alga-psa/tags/lib/loadDisplayTags', () => ({
  loadDisplayTagsForEntities: vi.fn(async () => new Map()),
  displayTagKey: (type: string, id: string) => `${type}:${id}`,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../models/ticket', () => ({ default: class Ticket {} }));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ validateData: (_s: unknown, v: unknown) => v }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(),
  publishBuiltWorkflowPayload: vi.fn(),
  publishNonCatalogEventByName: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
}));
vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({ publish: vi.fn() }),
  getRedisClient: vi.fn(),
  getRedisConfig: vi.fn(() => ({ prefix: 'alga-psa:' })),
}));
vi.mock('@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee', () => ({
  assertHumanWorkAssignee: vi.fn(),
  assertHumanWorkOwner: vi.fn(),
}));
vi.mock('@alga-psa/shared/lib/tickets/ticketLifecycleEvents', () => ({
  publishTicketTransitionsAfterCommit: vi.fn(),
  captureTicketTransitionSnapshot: vi.fn(),
}));
vi.mock('@alga-psa/shared/models/ticketModel', () => ({ TicketModel: {} }));
vi.mock('../lib/workflowTicketTransitionEvents', () => ({ buildTicketTransitionWorkflowEvents: vi.fn(() => []) }));
vi.mock('../lib/workflowTicketCommunicationEvents', () => ({ buildTicketCommunicationWorkflowEvents: vi.fn(() => []) }));
vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(() => null),
  publishWorkflowTicketSlaStageEvent: vi.fn(),
}));
vi.mock('../lib/validateTicketClosure', () => ({ enforceTicketCloseRules: vi.fn() }));
vi.mock('./ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
  previewBundleStatusPropagation: vi.fn(),
  propagateBundleMasterStatus: vi.fn(),
  mirrorCommentToChild: vi.fn(),
}));

import { getConsolidatedTicketData } from './optimizedTicketActions';

import {
  NATIVE_TICKET_CAPABILITIES,
  SEAT_TECHNICIAN_TICKET_CAPABILITIES,
} from '../lib/ticketDataSource';

const TICKET_ID = 'ticket-1';
const SCHEDULE_TABLE = 'schedule_entries';
const BUNDLE_TABLE = 'ticket_bundle_settings';

describe('getConsolidatedTicketData capability-gated reads (F048)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersQueries = [];
    queriedTables = [];
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => unknown) => cb({ ref: (column: string) => column, raw: (sql: string) => sql }));
    hasPermissionMock.mockResolvedValue(true);
    tables = {
      tickets: [{ ticket_id: TICKET_ID, tenant: 'tenant-1', title: 'Printer down', entered_by: 'u-msp', assigned_to: 'u-msp', client_id: null, contact_name_id: null, board_id: null, attributes: {} }],
      users: [credentialRow({ user_id: 'u-msp' })],
    };
    getAllbyTicketIdMock.mockResolvedValue([]);
    currentUser = { user_id: 'u-msp', tenant: 'tenant-1', user_type: 'internal', roles: [] };
  });

  it('a caller that passes no capabilities still reads schedule entries and bundle settings', async () => {
    const result = await getConsolidatedTicketData(TICKET_ID);
    expect(result.ticket?.ticket_id).toBe(TICKET_ID);
    expect(queriedTables).toContain(SCHEDULE_TABLE);
    expect(queriedTables).toContain(BUNDLE_TABLE);
    expect(result.bundle).toMatchObject({ isBundleChild: false, isBundleMaster: false, children: [] });
    expect(result.agentSchedules).toEqual([]);
  });

  it('the native capability set reads both', async () => {
    await getConsolidatedTicketData(TICKET_ID, NATIVE_TICKET_CAPABILITIES);
    expect(queriedTables).toContain(SCHEDULE_TABLE);
    expect(queriedTables).toContain(BUNDLE_TABLE);
  });

  it('the seat set reads neither, and returns the empty shapes the screen handles', async () => {
    const result = await getConsolidatedTicketData(TICKET_ID, SEAT_TECHNICIAN_TICKET_CAPABILITIES);
    expect(result.ticket?.ticket_id).toBe(TICKET_ID);
    expect(queriedTables).not.toContain(SCHEDULE_TABLE);
    expect(queriedTables).not.toContain(BUNDLE_TABLE);
    expect(result.agentSchedules).toEqual([]);
    expect(result.bundle).toMatchObject({
      isBundleChild: false, isBundleMaster: false, mode: null, reopenOnChildReply: false,
      masterTicket: null, children: [], openChildrenCount: 0,
    });
    expect(result.aggregatedChildClientComments).toEqual([]);
  });

  it('each capability gates only its own read', async () => {
    await getConsolidatedTicketData(TICKET_ID, { ...NATIVE_TICKET_CAPABILITIES, scheduling: false });
    expect(queriedTables).not.toContain(SCHEDULE_TABLE);
    expect(queriedTables).toContain(BUNDLE_TABLE);
    queriedTables = [];
    await getConsolidatedTicketData(TICKET_ID, { ...NATIVE_TICKET_CAPABILITIES, bundles: false });
    expect(queriedTables).toContain(SCHEDULE_TABLE);
    expect(queriedTables).not.toContain(BUNDLE_TABLE);
  });
});

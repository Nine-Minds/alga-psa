import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENSITIVE_USER_FIELDS, USER_RESPONSE_FIELD_NAMES } from '@alga-psa/types';

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getClientContactVisibilityContextMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table),
    tenantJoin: (builder: any, table: string) => builder.leftJoin(table),
  }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../models/ticket', () => ({
  default: class Ticket {},
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: (value: unknown) => value,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({
    publish: vi.fn(),
  }),
}));

vi.mock('@alga-psa/event-bus/events', () => ({
  TicketCreatedEvent: class {},
  TicketUpdatedEvent: class {},
  TicketClosedEvent: class {},
  TicketResponseStateChangedEvent: class {},
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {},
}));

vi.mock('@alga-psa/shared/services/tickets/ticketModelEventPublisher', () => ({
  TicketModelEventPublisher: class {},
}));

vi.mock('../lib/adapters/TicketModelAnalyticsTracker', () => ({
  TicketModelAnalyticsTracker: class {},
}));

vi.mock('@alga-psa/tickets/lib/itilUtils', () => ({
  calculateItilPriority: vi.fn(),
}));

vi.mock('../lib/workflowTicketTransitionEvents', () => ({
  buildTicketTransitionWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketCommunicationEvents', () => ({
  buildTicketCommunicationWorkflowEvents: vi.fn(() => []),
}));

vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(() => null),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(() => null),
}));

vi.mock('../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getClientContactVisibilityContextMock(...args),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

// Every credential-ish key that must never appear anywhere in a getTicketById result.
const FORBIDDEN_KEYS = new Set<string>([
  ...SENSITIVE_USER_FIELDS,
  'hashed_password',
  'two_factor_secret',
  'password',
]);
const SECRET_VALUES = ['$2b$10$hash-of-agent-one', 'JBSWY3DPEHPK3PXP-agent-one', '$2b$10$hash-of-agent-two'];

/**
 * Full `users` rows as the database holds them, credentials included. The fake query builder
 * below applies `.select(columns)` and `.where({ is_inactive })` the way Postgres would, so an
 * unprojected select leaks these and a projected one cannot.
 */
const USER_ROWS: Array<Record<string, unknown>> = [
  {
    user_id: 'agent-1', tenant: 'tenant-1', username: 'agent.one', first_name: 'Ada', last_name: 'One',
    email: 'ada@example.com', user_type: 'internal', is_inactive: false, icon: null,
    hashed_password: SECRET_VALUES[0], two_factor_secret: SECRET_VALUES[1], two_factor_enabled: true,
    password: 'legacy-plain',
  },
  {
    user_id: 'agent-2', tenant: 'tenant-1', username: 'agent.two', first_name: 'Bo', last_name: 'Two',
    email: 'bo@example.com', user_type: 'internal', is_inactive: false, icon: null,
    hashed_password: SECRET_VALUES[2], two_factor_secret: null, two_factor_enabled: false,
  },
  {
    user_id: 'agent-3', tenant: 'tenant-1', username: 'gone', first_name: 'Cy', last_name: 'Gone',
    email: 'cy@example.com', user_type: 'internal', is_inactive: true, icon: null,
    hashed_password: 'inactive-hash', two_factor_secret: 'inactive-secret',
  },
];

function makeTicketQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Ticket Title',
    board_id: 'board-allow',
    client_id: 'client-1',
    contact_name_id: null,
    status_id: 'status-1',
    entered_by: 'creator-1',
    assigned_to: null,
    entered_at: '2026-02-09T00:00:00.000Z',
    updated_at: '2026-02-09T00:00:00.000Z',
    closed_at: null,
    attributes: {},
    status_name: 'Open',
    is_closed: false,
    board_name: 'Service Board',
    assigned_to_first_name: null,
    assigned_to_last_name: null,
    contact_name: null,
    client_name: 'Client A',
    source: null,
    email_metadata: null,
    entered_by_user_type: 'internal',
    ...overrides,
  };
}

function buildTrx(usersQueries: Array<{ columns: string[] | null }>) {
  return ((table: string) => {
    if (table === 'tickets as t') {
      return {
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(makeTicketQueryResult()),
      };
    }

    if (table === 'user_roles' || table === 'team_members') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([]),
        }),
      };
    }

    if (table === 'ticket_resources') {
      const rows = [{ assigned_to: 'agent-1', additional_user_id: 'agent-2', ticket_id: 'ticket-1', tenant: 'tenant-1' }];
      const builder: any = {
        where: vi.fn(() => builder),
        whereIn: vi.fn(() => builder),
        whereNotNull: vi.fn(() => builder),
        select: vi.fn(async () => rows),
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    }

    if (table === 'users') {
      // Two callers hit `users`: the authorization subject lookup (`where({ reports_to }).select('user_id')`,
      // not a response) and the agent directory (`select(...).where({ is_inactive }).orderBy(...)`).
      // Only the latter is recorded, when it executes via orderBy.
      let columns: string[] | null = null;
      let rows = USER_ROWS;
      let managedLookup = false;
      const builder: any = {
        select: vi.fn((...requested: unknown[]) => {
          if (managedLookup) {
            return Promise.resolve([]);
          }
          columns = requested.flat() as string[];
          rows = rows.map((row) => Object.fromEntries(columns!.map((column) => [column, row[column]])));
          return builder;
        }),
        where: vi.fn((clause: Record<string, unknown>) => {
          if (clause && typeof clause === 'object' && 'reports_to' in clause) {
            managedLookup = true;
          } else if (clause && typeof clause === 'object' && 'is_inactive' in clause) {
            rows = rows.filter((row) => row.is_inactive === clause.is_inactive);
          }
          return builder;
        }),
        orderBy: vi.fn(async () => {
          usersQueries.push({ columns });
          return rows;
        }),
      };
      return builder;
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, found));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      found.add(key);
      collectKeys(entry, found);
    }
  }
  return found;
}

function expectNoCredentials(result: unknown) {
  const keys = collectKeys(result);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `result must not contain a "${forbidden}" key`).toBe(false);
  }
  const serialized = JSON.stringify(result);
  for (const secret of SECRET_VALUES) {
    expect(serialized).not.toContain(secret);
  }
}

describe('getTicketById never serializes credential-bearing user rows', () => {
  let usersQueries: Array<{ columns: string[] | null }>;

  beforeEach(() => {
    vi.clearAllMocks();
    usersQueries = [];
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    hasPermissionMock.mockResolvedValue(true);
    getClientContactVisibilityContextMock.mockResolvedValue({
      ticketScope: 'client',
      effectiveTicketScope: 'client',
      isClientAdmin: false,
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-allow'],
    });
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => callback(buildTrx(usersQueries))
    );
  });

  it('MSP reader: no sensitive key or secret value appears anywhere in the result', async () => {
    currentUser = { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };

    const { getTicketById } = await import('./ticketActions');
    const result = await getTicketById('ticket-1');

    expect(result.ticket_id).toBe('ticket-1');
    expect(result.availableAgents).toBeDefined();
    expectNoCredentials(result);
  });

  it('MSP reader: availableAgents entries only carry allow-listed fields, for active users only', async () => {
    currentUser = { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };

    const { getTicketById } = await import('./ticketActions');
    const result = await getTicketById('ticket-1');

    const allowed = new Set<string>([...USER_RESPONSE_FIELD_NAMES, 'roles']);
    expect(result.availableAgents!.map((agent) => agent.user_id)).toEqual(['agent-1', 'agent-2']);
    for (const agent of result.availableAgents!) {
      for (const key of Object.keys(agent)) {
        expect(allowed.has(key), `unexpected availableAgents key "${key}"`).toBe(true);
      }
      expect(agent.first_name).toBeTruthy();
      expect(agent.email).toBeTruthy();
    }

    // The query itself must be projected (not a bare users.*).
    expect(usersQueries).toHaveLength(1);
    expect(usersQueries[0].columns).toEqual(USER_RESPONSE_FIELD_NAMES);
  });

  it('client reader: availableAgents is omitted, the users table is never queried, and no credentials appear', async () => {
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      tenant: 'tenant-1',
      clientId: 'client-1',
      contact_id: 'contact-1',
      roles: [],
    };

    const { getTicketById } = await import('./ticketActions');
    const result = await getTicketById('ticket-1');

    expect(result.ticket_id).toBe('ticket-1');
    expect(result.availableAgents).toBeUndefined();
    expect('availableAgents' in result).toBe(false);
    expect(usersQueries).toHaveLength(0);
    // additionalAgents is a different table and stays as-is.
    expect(result.additionalAgents).toHaveLength(1);
    expectNoCredentials(result);
  });
});

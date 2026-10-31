import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SENSITIVE_USER_FIELDS, USER_RESPONSE_FIELD_NAMES } from '@alga-psa/types';

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
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: () => ({
    table: (table: string) => makeBuilder(table),
    unscoped: (table: string) => makeBuilder(table),
    tenantJoin: (builder: unknown) => builder,
    scoped: (table: string) => makeBuilder(table),
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

const TICKET_ID = 'ticket-1';
const sensitiveKeys = new Set<string>(SENSITIVE_USER_FIELDS);
const allowedKeys = new Set<string>(USER_RESPONSE_FIELD_NAMES);

function findSensitiveKeyPaths(value: unknown, path = '$', seen = new WeakSet<object>()): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveKeyPaths(item, `${path}[${index}]`, seen));
  }
  return Object.entries(value as Row).flatMap(([key, child]) => [
    ...(sensitiveKeys.has(key) ? [`${path}.${key}`] : []),
    ...findSensitiveKeyPaths(child, `${path}.${key}`, seen),
  ]);
}

describe('getConsolidatedTicketData user credential exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersQueries = [];
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => unknown) => cb({ ref: (column: string) => column, raw: (sql: string) => sql }));
    hasPermissionMock.mockResolvedValue(true);

    tables = {
      tickets: [
        {
          ticket_id: TICKET_ID,
          tenant: 'tenant-1',
          title: 'Printer down',
          entered_by: 'u-creator',
          updated_by: 'u-updater',
          assigned_to: 'u-msp',
          client_id: null,
          contact_name_id: null,
          board_id: null,
          attributes: {},
        },
      ],
      users: [
        credentialRow({ user_id: 'u-msp', first_name: 'Maya', last_name: 'Reader' }),
        credentialRow({ user_id: 'u-creator', first_name: 'Cora', last_name: 'Creator' }),
        credentialRow({ user_id: 'u-updater', first_name: 'Uma', last_name: 'Updater' }),
        credentialRow({ user_id: 'u-agent', first_name: 'Abe', last_name: 'Agent' }),
        // Not in the agent picker (inactive), but authored a comment -> extraCommentAuthors path.
        credentialRow({ user_id: 'u-former', first_name: 'Fay', last_name: 'Former', is_inactive: true }),
      ],
    };
    getAllbyTicketIdMock.mockResolvedValue([
      {
        comment_id: 'c-1',
        ticket_id: TICKET_ID,
        user_id: 'u-former',
        note: 'hello',
        is_internal: false,
        is_resolution: false,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    currentUser = { user_id: 'u-msp', tenant: 'tenant-1', user_type: 'internal', roles: [] };
  });

  it('sanity: the fake users table really carries credentials (so the test can fail)', () => {
    for (const row of tables.users) {
      expect(row).toHaveProperty('hashed_password');
      expect(row).toHaveProperty('two_factor_secret');
    }
  });

  it('(a) an MSP reader receives no SENSITIVE_USER_FIELDS key anywhere in the bundle', async () => {
    const result = await getConsolidatedTicketData(TICKET_ID);

    expect(result.permissionError ?? result.actionError).toBeUndefined();
    expect(result.ticket?.ticket_id).toBe(TICKET_ID);
    expect(result.createdByUser).toBeTruthy();
    expect(result.updatedByUser).toBeTruthy();
    expect(result.availableAgents.length).toBeGreaterThan(0);
    expect(findSensitiveKeyPaths(result)).toEqual([]);
    // Belt and braces for secret values nested under unexpected keys.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('not-a-real-hash');
    expect(serialized).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('(b) availableAgents, createdByUser and updatedByUser carry allow-listed keys only', async () => {
    const result = await getConsolidatedTicketData(TICKET_ID);

    expect(result.availableAgents.map((agent: Row) => agent.user_id)).toEqual(
      expect.arrayContaining(['u-msp', 'u-agent'])
    );
    // Picker stays internal + active only.
    expect(result.availableAgents.map((agent: Row) => agent.user_id)).not.toContain('u-former');

    const extraKeys = (row: Row) => Object.keys(row).filter((key) => !allowedKeys.has(key) && key !== 'roles');
    for (const agent of result.availableAgents as Row[]) {
      expect(extraKeys(agent)).toEqual([]);
    }
    expect(extraKeys(result.createdByUser)).toEqual([]);
    expect(extraKeys(result.updatedByUser)).toEqual([]);
    expect(result.createdByUser).toMatchObject({ user_id: 'u-creator', first_name: 'Cora', last_name: 'Creator' });
    expect(result.updatedByUser).toMatchObject({ user_id: 'u-updater', first_name: 'Uma', last_name: 'Updater' });
  });

  it('(b2) every users query in the action projects an explicit allow-listed column list', async () => {
    const result = await getConsolidatedTicketData(TICKET_ID);

    // Comment author display data still resolves for a user outside the picker.
    expect(result.userMap['u-former']).toMatchObject({ first_name: 'Fay', last_name: 'Former' });

    // No users query may be an unprojected users.* read.
    expect(usersQueries.filter((query) => query.selected === null)).toEqual([]);
    // availableAgents, createdByUser, updatedByUser and extraCommentAuthors each project the
    // allow-list (the authorization-subject lookups use their own single-column select).
    const wide = usersQueries.filter((query) => (query.selected as string[]).length > 1);
    expect(wide).toHaveLength(4);
    for (const query of wide) {
      for (const column of query.selected as string[]) {
        expect(sensitiveKeys.has(column)).toBe(false);
        expect(allowedKeys.has(column)).toBe(true);
      }
    }
  });

  it('(c) a client principal is refused and receives no bundle', async () => {
    currentUser = {
      user_id: 'u-portal',
      tenant: 'tenant-1',
      user_type: 'client',
      roles: [],
      clientId: 'client-own',
      contact_id: 'contact-own',
    };
    // The ticket belongs to this client, so ticket authorization alone would let the portal user
    // read it: the refusal below must come from the MSP-only principal gate, not from "cannot view".
    tables.tickets[0].client_id = 'client-own';

    // The action's outer handler turns "Permission denied:" errors into the standard
    // { permissionError } envelope; either a throw or that envelope is a refusal, a bundle is not.
    const outcome: any = await getConsolidatedTicketData(TICKET_ID).catch((error: Error) => ({
      permissionError: error.message,
    }));
    expect(outcome.permissionError).toMatch(/Permission denied: consolidated ticket data is an MSP view/);
    for (const key of ['ticket', 'availableAgents', 'createdByUser', 'updatedByUser', 'comments', 'clients', 'userMap']) {
      expect(outcome).not.toHaveProperty(key);
    }
    // Refused before any data is fetched.
    expect(getAllbyTicketIdMock).not.toHaveBeenCalled();
    expect(usersQueries).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENSITIVE_USER_FIELDS } from '@alga-psa/types';

// Regression: the MSP ticket page loads through getConsolidatedTicketData / getTicketFormOptions, not
// getTicketById. Every `users` read in them (agent list, created/updated-by, extra comment authors,
// form-option users) must be projected to the shared allow-list. The fake `users` table applies
// `.select(columns)` the way Postgres would, so an unprojected read returns the credential columns.

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const loadDisplayTagsForEntitiesMock = vi.fn();

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
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (builder: any) => builder,
    tenantWhereColumn: (builder: any) => builder,
  }),
  registerAfterCommit: vi.fn(),
  getConnection: vi.fn(),
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
  loadDisplayTagsForEntities: (...args: any[]) => loadDisplayTagsForEntitiesMock(...args),
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


vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(async () => null),
  getUserAvatarUrl: vi.fn(async () => null),
  getClientLogoUrlsBatch: vi.fn(async () => new Map()),
  getEntityImageUrlsBatch: vi.fn(async () => new Map()),
}));
vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: vi.fn(async (_t: unknown, _tenant: string, _u: unknown, docs: unknown[]) => docs),
}));
vi.mock('../models/comment', () => ({
  default: { getAllbyTicketId: vi.fn(async () => COMMENTS) },
}));

import { getConsolidatedTicketData, getTicketFormOptions } from './optimizedTicketActions';

const FORBIDDEN_KEYS = new Set<string>([...SENSITIVE_USER_FIELDS, 'hashed_password', 'two_factor_secret', 'password']);
const SECRET_VALUES = ['$2b$10$HASH-agent-one', 'REVIEWCANARY2FAHATTER', '$2b$10$HASH-creator', '$2b$10$HASH-client-author'];

function userRow(id: string, extra: Record<string, unknown>) {
  return {
    user_id: id, tenant: 'tenant-1', username: id, first_name: `First-${id}`, last_name: `Last-${id}`,
    email: `${id}@example.com`, user_type: 'internal', is_inactive: false, icon: null, contact_id: null,
    hashed_password: `$2b$10$HASH-${id}`, two_factor_secret: 'REVIEWCANARY2FAHATTER', password: 'legacy',
    ...extra,
  };
}

const USER_ROWS = [
  userRow('agent-1', {}),
  userRow('creator-1', { is_inactive: true }),
  userRow('updater-1', { user_type: 'internal' }),
  userRow('client-author', { user_type: 'client' }),
];

const COMMENTS = [{ comment_id: 'c1', user_id: 'client-author', note: 'hi' }];

const TICKET = {
  ticket_id: 'ticket-1', ticket_number: 'T-1', title: 'T', board_id: null, client_id: null, contact_name_id: null,
  status_id: 's1', entered_by: 'creator-1', updated_by: 'updater-1', assigned_to: null, attributes: {},
  entered_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', closed_at: null, tenant: 'tenant-1',
};

/** Chainable, awaitable fake query builder. `users` honours select()/where()/whereIn()/first()/limit(). */
function makeBuilder(table: string) {
  const state: { cols: string[] | null; rows: any[]; single: boolean } = {
    cols: null, rows: table === 'users' ? [...USER_ROWS] : table === 'tickets as t' ? [TICKET] : [], single: false,
  };
  const project = (r: any) => (state.cols ? Object.fromEntries(state.cols.filter((c) => c in r).map((c) => [c, r[c]])) : r);
  const run = () => {
    const out = state.rows.map(project);
    return state.single ? out[0] : out;
  };
  const b: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve().then(run).then(res, rej);
      if (prop === 'catch') return (rej: any) => Promise.resolve().then(run).catch(rej);
      return (...args: any[]) => {
        if (prop === 'select' && table === 'users') {
          state.cols = args.flat().length ? (args.flat() as string[]) : null;
        } else if (prop === 'where' && table === 'users') {
          const c = args[0];
          if (c && typeof c === 'object') state.rows = state.rows.filter((r) => Object.entries(c).every(([k, v]) => r[k] === v));
          else if (typeof c === 'string' && args.length === 2) state.rows = state.rows.filter((r) => r[c] === args[1]);
        } else if (prop === 'whereIn' && table === 'users') {
          state.rows = state.rows.filter((r) => args[1].includes(r[args[0]]));
        } else if (prop === 'first') {
          state.single = true;
        } else if (prop === 'limit' && table === 'users') {
          state.rows = state.rows.slice(0, args[0]);
        }
        return b;
      };
    },
  });
  return b;
}

function buildTrx() {
  const trx: any = (table: string) => makeBuilder(table);
  trx.raw = (s: string) => s;
  trx.fn = { now: () => 'now' };
  return trx;
}

function collectForbidden(value: unknown, path = '$', hits: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => collectForbidden(v, `${path}[${i}]`, hits));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) hits.push(`${path}.${k}`);
      collectForbidden(v, `${path}.${k}`, hits);
    }
  }
  return hits;
}

const DISPLAY_FIELDS = ['user_id', 'first_name', 'last_name', 'email', 'user_type'];

describe('ticket detail loaders never return credential columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => unknown) => cb(buildTrx()));
    hasPermissionMock.mockResolvedValue(true);
    currentUser = { user_id: 'u-msp', tenant: 'tenant-1', user_type: 'internal' };
  });

  it('getConsolidatedTicketData: agents, created/updated-by, comment authors and userMap are sanitized', async () => {
    const result: any = await getConsolidatedTicketData('ticket-1');

    expect(collectForbidden(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/REVIEWCANARY2FAHATTER|\$2b\$10\$HASH/);

    expect(result.availableAgents.map((a: any) => a.user_id)).toEqual(['agent-1', 'updater-1']);
    for (const f of DISPLAY_FIELDS) expect(result.availableAgents[0]).toHaveProperty(f);
    expect(result.createdByUser).toMatchObject({ user_id: 'creator-1', first_name: 'First-creator-1', email: 'creator-1@example.com', user_type: 'internal' });
    expect(result.updatedByUser).toMatchObject({ user_id: 'updater-1', last_name: 'Last-updater-1' });
    expect(result.userMap['client-author']).toMatchObject({ user_id: 'client-author', first_name: 'First-client-author', user_type: 'client' });
    expect(result.userMap['agent-1']).toMatchObject({ first_name: 'First-agent-1' });
    expect(result.options.agent.map((a: any) => a.value)).toContain('agent-1');
  });

  it('getTicketFormOptions: users are sanitized', async () => {
    const result: any = await getTicketFormOptions();

    expect(result).not.toHaveProperty('permissionError');
    expect(collectForbidden(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/REVIEWCANARY2FAHATTER|\$2b\$10\$HASH/);
    expect(result.users).toHaveLength(USER_ROWS.length);
    for (const f of DISPLAY_FIELDS) expect(result.users[0]).toHaveProperty(f);
  });
});

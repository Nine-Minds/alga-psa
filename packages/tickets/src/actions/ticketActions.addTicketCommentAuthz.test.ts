// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTicketComment } from './ticketActions';

// Real authorization kernel + real ticketRecordAuthorization; only the DB and the
// contact-visibility resolver are faked.

let currentUser: any;
let ticketRow: Record<string, unknown> | null;
let visibilityByContact: Record<string, any>;
let inserts: Array<{ table: string; row: any }>;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn() }));

/** Permissive chainable query builder: awaiting yields [], `.first()` yields the table's row. */
function makeBuilder(table: string) {
  const builder: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: any) => resolve([]);
      }
      if (prop === 'first') {
        return async () => (table === 'tickets' ? ticketRow ?? undefined : undefined);
      }
      if (prop === 'insert') {
        return (row: any) => {
          inserts.push({ table, row });
          const result: any = Promise.resolve([row]);
          result.returning = async () => [{ ...row }];
          return result;
        };
      }
      return () => builder;
    },
  });
  return builder;
}
function makeTrx() {
  const trx: any = (table: string) => makeBuilder(table);
  trx.raw = async () => ({ rows: [{ comment_id: 'comment-new', thread_id: 'thread-new' }] });
  trx.isTransaction = true;
  trx.fn = { now: () => new Date() };
  return trx;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  registerAfterCommit: vi.fn(),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    subquery: (table: string) => conn(table),
    tenantJoin: (query: any) => query,
    unscoped: (table: string) => conn(table),
    scoped: (table: string) => ({ builder: conn(table) }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../models/ticket', () => ({ default: class Ticket {} }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ validateData: (_s: unknown, v: unknown) => v }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus', () => ({ getEventBus: () => ({ publish: vi.fn() }) }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn(async () => 'markdown'),
}));
vi.mock('../lib/cannedResponses/commentMerge', () => ({
  resolveCommentMergeTokens: vi.fn(async (_trx, _tenant, _id, _uid, _type, content: string) => content),
}));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  reconcileCommentAttachments: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({
  persistCommentPublication: vi.fn(async () => undefined),
  reconcileCommentAttachments: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: async (_trx: unknown, _tenant: string, contactId: string) => {
    const ctx = visibilityByContact[contactId];
    if (!ctx) throw new Error('visibility unresolved');
    return ctx;
  },
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import { persistCommentPublication } from '@alga-psa/shared/lib/ticketCommentAttachments';

const CONTENT = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]);

function clientUser(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'client-user-1', user_type: 'client', tenant: 'tenant-1', contact_id: 'contact-1',
    clientId: 'client-1', roles: [{ role_id: 'role-client' }], ...overrides,
  };
}
const internalUser = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-1', roles: [{ role_id: 'r' }] };
const visibility = () => ({
  effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
  visibleBoardIds: ['board-1'], grantedTicketProfileIds: [], isClientAdmin: false, visibilityGroupId: 'group-1',
});
const ticket = (overrides: Record<string, unknown> = {}) => ({
  ticket_id: 'ticket-1', tenant: 'tenant-1', client_id: 'client-1', board_id: 'board-1',
  contact_name_id: 'contact-1', billing_profile_id: null, attributes: {}, assigned_to: null,
  entered_by: 'someone', assigned_team_id: null, ...overrides,
});
const comments = () => inserts.filter((i) => i.table === 'comments');

describe('addTicketComment (ticketActions) authorization', () => {
  beforeEach(() => {
    inserts = [];
    vi.mocked(persistCommentPublication).mockClear();
    ticketRow = ticket();
    visibilityByContact = { 'contact-1': visibility() };
    currentUser = clientUser();
    hasPermissionMock.mockReset().mockResolvedValue(true);
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    withTransactionMock.mockReset().mockImplementation(async (_knex: any, cb: any) => cb(makeTrx()));
  });

  it('rejects a client writing to another client\'s ticket, with no thread/comment insert or publication', async () => {
    ticketRow = ticket({ client_id: 'client-2', contact_name_id: 'contact-9' });
    const result: any = await addTicketComment('ticket-1', CONTENT, false);
    expect(result).toBeDefined();
    expect(result?.message ?? result?.error ?? JSON.stringify(result)).toMatch(/denied|permission/i);
    expect(inserts).toEqual([]);
    expect(persistCommentPublication).not.toHaveBeenCalled();
  });

  it('gives a client the same denial for a missing ticket', async () => {
    ticketRow = null;
    const result: any = await addTicketComment('ticket-missing', CONTENT, false);
    expect(JSON.stringify(result)).toMatch(/denied|permission/i);
    expect(JSON.stringify(result)).not.toMatch(/not found/i);
    expect(inserts).toEqual([]);
  });

  it('rejects a client passing isInternal=true on their own visible ticket', async () => {
    const result: any = await addTicketComment('ticket-1', CONTENT, true);
    expect(JSON.stringify(result ?? null)).toMatch(/Only MSP users can create internal comments/);
    expect(inserts).toEqual([]);
  });

  it('lets a client write to their own visible ticket, stored as author_type client and public', async () => {
    const result = await addTicketComment('ticket-1', CONTENT, false);
    expect(result).toBeUndefined();
    expect(comments()).toHaveLength(1);
    expect(comments()[0].row.author_type).toBe('client');
    expect(comments()[0].row.is_internal).toBe(false);
    expect(persistCommentPublication).toHaveBeenCalledTimes(1);
  });

  it('leaves an internal MSP user unaffected: author_type internal and isInternal honoured', async () => {
    currentUser = internalUser;
    ticketRow = ticket({ client_id: 'client-2', contact_name_id: 'contact-9' });
    expect(await addTicketComment('ticket-1', CONTENT, true)).toBeUndefined();
    expect(comments()[0].row.author_type).toBe('internal');
    expect(comments()[0].row.is_internal).toBe(true);
  });
});

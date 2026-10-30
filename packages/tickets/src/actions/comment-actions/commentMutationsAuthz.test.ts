// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateComment, deleteComment } from './commentActions';
import { toggleCommentReaction } from './commentReactionActions';

// Real authorization kernel + real ticketRecordAuthorization; only the DB and the
// contact-visibility resolver are faked.

let currentUser: any;
let ticketRow: Record<string, unknown> | null;
let commentRow: Record<string, unknown> | null;
let writes: Array<{ table: string; op: string }>;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const commentUpdate = vi.fn();
const commentDelete = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => hasPermissionMock(...args) }));

function makeBuilder(table: string) {
  const builder: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') return (resolve: any) => resolve([]);
      if (prop === 'first') {
        return async () => (table === 'tickets' ? ticketRow ?? undefined : table === 'comments' ? commentRow ?? undefined : undefined);
      }
      if (prop === 'insert' || prop === 'update' || prop === 'del' || prop === 'delete') {
        return () => {
          writes.push({ table, op: prop });
          return Promise.resolve([]);
        };
      }
      return () => builder;
    },
  });
  return builder;
}
function makeTrx() {
  const trx: any = (table: string) => makeBuilder(table);
  trx.raw = async () => ({ rows: [] });
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
vi.mock('../../models/comment', () => ({
  default: {
    get: vi.fn(async () => commentRow),
    update: (...args: any[]) => commentUpdate(...args),
    delete: (...args: any[]) => commentDelete(...args),
  },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({ persistCommentPublication: vi.fn() }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({ withdrawCommentAttachments: vi.fn() }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn(async () => 'md') }));
vi.mock('@alga-psa/core', () => ({ scheduleJobAt: vi.fn(), cancelScheduledJob: vi.fn() }));
vi.mock('../../lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn(async () => undefined) }));
vi.mock('../../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: async () => ({
    effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
    visibleBoardIds: ['board-1'], grantedTicketProfileIds: [], isClientAdmin: false, visibilityGroupId: 'g',
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

const client = { user_id: 'client-user-1', user_type: 'client', tenant: 'tenant-1', contact_id: 'contact-1', clientId: 'client-1', roles: [{ role_id: 'rc' }] };
const ownTicket = { ticket_id: 'ticket-1', tenant: 'tenant-1', client_id: 'client-1', board_id: 'board-1', contact_name_id: 'contact-1', billing_profile_id: null, attributes: {}, assigned_to: null, entered_by: 'x', assigned_team_id: null };
const foreignTicket = { ...ownTicket, ticket_id: 'ticket-2', client_id: 'client-2', contact_name_id: 'contact-9' };
// A comment the client authored (e.g. planted through the old unguarded path) on a ticket it cannot see.
const ownComment = (ticket_id: string) => ({ comment_id: 'c-1', ticket_id, user_id: 'client-user-1', note: 'x', is_internal: false, tenant: 'tenant-1' });

describe('comment mutations: client principals need record access to the owning ticket', () => {
  beforeEach(() => {
    writes = [];
    currentUser = client;
    ticketRow = foreignTicket;
    commentRow = ownComment('ticket-2');
    hasPermissionMock.mockReset().mockResolvedValue(true);
    commentUpdate.mockReset();
    commentDelete.mockReset();
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    withTransactionMock.mockReset().mockImplementation(async (_k: any, cb: any) => cb(makeTrx()));
  });

  it('updateComment: rejects a client editing their own comment on a ticket they cannot see', async () => {
    const result: any = await updateComment('c-1', { note: 'edited' }).catch((e) => e);
    expect(JSON.stringify(result?.message ?? result)).toMatch(/denied|permission/i);
    expect(commentUpdate).not.toHaveBeenCalled();
  });

  it('updateComment: still lets a client edit their own comment on a visible ticket', async () => {
    ticketRow = ownTicket;
    commentRow = ownComment('ticket-1');
    await updateComment('c-1', { note: 'edited' });
    expect(commentUpdate).toHaveBeenCalledTimes(1);
  });

  it('deleteComment: rejects a client deleting their own comment on a ticket they cannot see', async () => {
    const result: any = await deleteComment('c-1').catch((e) => e);
    expect(JSON.stringify(result?.message ?? result)).toMatch(/denied|permission/i);
    expect(commentDelete).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('toggleCommentReaction: rejects a client reacting on a comment of a ticket they cannot see', async () => {
    const result: any = await toggleCommentReaction('c-1', '👍').catch((e) => e);
    expect(String(result?.message ?? result)).toMatch(/Permission denied/);
    expect(writes).toEqual([]);
  });

  it('toggleCommentReaction: gives a client the same denial for a missing comment', async () => {
    commentRow = null;
    const result: any = await toggleCommentReaction('c-missing', '👍').catch((e) => e);
    expect(String(result?.message ?? result)).toMatch(/Permission denied/);
  });

  it('toggleCommentReaction: allows a client on a visible ticket', async () => {
    ticketRow = ownTicket;
    commentRow = ownComment('ticket-1');
    await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
  });

  it('toggleCommentReaction: internal MSP users get no new record check', async () => {
    currentUser = { user_id: 'i-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
    await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
  });
});

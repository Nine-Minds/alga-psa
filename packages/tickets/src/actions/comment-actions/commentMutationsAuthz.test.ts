// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createComment, updateComment, deleteComment } from './commentActions';
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
const commentInsert = vi.fn();
let commentAuthorType = 'client';
let parentThreadRow: Record<string, unknown> | null = null;

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
        return async () => (table === 'tickets' ? ticketRow ?? undefined : table === 'comments' ? commentRow ?? undefined : table === 'comments as parent' ? parentThreadRow ?? undefined : undefined);
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
    insert: (...args: any[]) => commentInsert(...args),
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
vi.mock('@alga-psa/shared/lib/tickets/responseState', () => ({
  resolveCommentAuthor: vi.fn(async () => ({ authorType: commentAuthorType })),
  applyCommentResponseState: vi.fn(async () => ({ previousState: null, newState: null })),
}));
vi.mock('../../lib/cannedResponses/commentMerge', () => ({ resolveCommentMergeTokens: vi.fn(async (_t: any, _n: any, _a: any, _b: any, _c: any, note: string) => note) }));
vi.mock('../../lib/workflowTicketCommunicationEvents', () => ({ buildTicketCommunicationWorkflowEvents: vi.fn(() => []), publishTicketCommunicationWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({ maybeReopenBundleMasterFromChildReply: vi.fn(async () => undefined) }));
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
    commentInsert.mockReset().mockResolvedValue('new-comment-id');
    commentAuthorType = 'client';
    parentThreadRow = null;
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

  describe('createComment', () => {
    const DENIED = 'Permission denied: Cannot access ticket';
    const newComment = (ticket_id: string, extra: Record<string, unknown> = {}): any => ({ ticket_id, note: 'hello', is_internal: false, ...extra });
    const outcome = async (c: any) => createComment(c, null).then((r: any) => ({ returned: r }), (e: any) => ({ thrown: e?.message ?? String(e) }));

    it('denies a client on a same-client ticket belonging to another contact', async () => {
      ticketRow = { ...ownTicket, contact_name_id: 'contact-9' };
      const result = await outcome(newComment('ticket-1'));
      expect(JSON.stringify(result)).toContain(DENIED);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('denies a client on their own contact ticket on a hidden board', async () => {
      ticketRow = { ...ownTicket, board_id: 'board-hidden' };
      const result = await outcome(newComment('ticket-1'));
      expect(JSON.stringify(result)).toContain(DENIED);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('gives the identical denial shape for nonexistent, peer-contact and hidden-board tickets', async () => {
      ticketRow = null;
      const missing = await outcome(newComment('ticket-nope'));
      ticketRow = { ...ownTicket, contact_name_id: 'contact-9' };
      const peer = await outcome(newComment('ticket-1'));
      ticketRow = { ...ownTicket, board_id: 'board-hidden' };
      const hidden = await outcome(newComment('ticket-1'));
      expect(missing).toEqual({ returned: { permissionError: DENIED } });
      expect(peer).toEqual(missing);
      expect(hidden).toEqual(missing);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('allows a client on their own visible ticket and inserts as author_type client', async () => {
      ticketRow = ownTicket;
      const result: any = await outcome(newComment('ticket-1'));
      expect(result.returned).toBe('new-comment-id');
      expect(commentInsert).toHaveBeenCalledTimes(1);
      expect(commentInsert.mock.calls[0][2]).toMatchObject({ author_type: 'client', ticket_id: 'ticket-1', user_id: 'client-user-1' });
    });

    it('still rejects a client internal comment', async () => {
      ticketRow = ownTicket;
      const result = await outcome(newComment('ticket-1', { is_internal: true }));
      expect(JSON.stringify(result)).toMatch(/internal comments/);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('still rejects a client reply into an internal thread (after record authorization)', async () => {
      ticketRow = ownTicket;
      parentThreadRow = { thread_is_internal: true };
      const result = await outcome(newComment('ticket-1', { parent_comment_id: 'p-1' }));
      expect(JSON.stringify(result)).toMatch(/Reply visibility must match/);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('does not reveal the parent thread to a client without ticket access', async () => {
      ticketRow = { ...ownTicket, contact_name_id: 'contact-9' };
      parentThreadRow = { thread_is_internal: true };
      const result = await outcome(newComment('ticket-1', { parent_comment_id: 'p-1' }));
      expect(JSON.stringify(result)).toContain(DENIED);
      expect(JSON.stringify(result)).not.toMatch(/Reply visibility/);
    });

    it('still rejects client scheduling', async () => {
      ticketRow = ownTicket;
      const result = await outcome(newComment('ticket-1', { scheduled_publish_at: '2030-01-01T00:00:00Z' }));
      expect(JSON.stringify(result)).toMatch(/Only internal MSP users may schedule/);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('internal MSP users get no record check and succeed unchanged', async () => {
      currentUser = { user_id: 'i-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
      commentAuthorType = 'internal';
      ticketRow = foreignTicket;
      const result: any = await outcome(newComment('ticket-2'));
      expect(JSON.stringify(result)).not.toContain(DENIED);
      expect(result.returned).toBe('new-comment-id');
      expect(commentInsert.mock.calls[0][2]).toMatchObject({ author_type: 'internal' });
    });
  });
});

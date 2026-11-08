// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createComment, updateComment, deleteComment } from './commentActions';
import { toggleCommentReaction, getCommentsReactionsBatch } from './commentReactionActions';
import * as ticketAuthz from '../../lib/ticketRecordAuthorization';

// Real authorization kernel + real ticketRecordAuthorization; only the DB and the
// contact-visibility resolver are faked.

let currentUser: any;
let ticketRow: Record<string, unknown> | null;
let commentRow: Record<string, unknown> | null;
let writes: Array<{ table: string; op: string }>;
// Rows returned by multi-row (awaited) queries, keyed by table. Unset => [].
let listRows: Record<string, any[]> = {};

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const commentUpdate = vi.fn();
const commentDelete = vi.fn();
const commentInsert = vi.fn();
let commentAuthorType = 'client';
let parentThreadRow: Record<string, unknown> | null = null;
let bundleRules: any[] = [];

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => hasPermissionMock(...args) }));

function makeBuilder(table: string) {
  const builder: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') return (resolve: any) => resolve(listRows[table] ?? []);
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
    insertRecord: async (...args: any[]) => ({ ...args[2], comment_id: await commentInsert(...args), thread_id: 'thread-1' }),
    update: (...args: any[]) => commentUpdate(...args),
    deleteRecord: (trx: any, tenant: string, row: any) => commentDelete(trx, tenant, row.comment_id),
  },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({ persistCommentPublication: vi.fn() }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({ withdrawCommentAttachments: vi.fn() }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn(async () => 'md') }));
vi.mock('@alga-psa/core', () => ({ scheduleJobAt: vi.fn(), cancelScheduledJob: vi.fn() }));
vi.mock('../../lib/ticketRecordAuthorization', async (importActual) => {
  const actual: any = await importActual();
  return { ...actual, authorizeTicketRecordAccessConcealed: vi.fn(actual.authorizeTicketRecordAccessConcealed) };
});
vi.mock('../../lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
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
vi.mock('@alga-psa/authorization/bundles/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/bundles/service')>()),
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => bundleRules),
  authorizationEvaluationSnapshotQuery: vi.fn(() => ({ as: () => null })),
  loadAuthorizationEvaluationSnapshot: vi.fn(async () => ({
    roleIds: [], teamIds: [], managedUserIds: [], rules: bundleRules.map((r) => ({ rule_id: r.id, resource_type: r.resource, action: r.action, template_key: r.templateKey, constraint_key: r.constraintKey ?? null, config: {} })),
  })),
}));

const client = { user_id: 'client-user-1', user_type: 'client', tenant: 'tenant-1', contact_id: 'contact-1', clientId: 'client-1', roles: [{ role_id: 'rc' }] };
const ownTicket = { ticket_id: 'ticket-1', tenant: 'tenant-1', client_id: 'client-1', board_id: 'board-1', contact_name_id: 'contact-1', billing_profile_id: null, attributes: {}, assigned_to: null, entered_by: 'x', assigned_team_id: null };
const foreignTicket = { ...ownTicket, ticket_id: 'ticket-2', client_id: 'client-2', contact_name_id: 'contact-9' };
// A comment the client authored (e.g. planted through the old unguarded path) on a ticket it cannot see.
const ownComment = (ticket_id: string) => ({ comment_id: 'c-1', ticket_id, user_id: 'client-user-1', note: 'x', is_internal: false, publish_state: 'published', thread_id: 'th-1', deleted_at: null, tenant: 'tenant-1' });

// A bundle-restricted MSP user: ticket read+update narrowed to own_or_assigned records.
const mspUser = { user_id: 'i-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
const ownOrAssignedRules = ['read', 'update'].map((action) => ({ id: `rule-${action}`, resource: 'ticket', action, templateKey: 'own_or_assigned' }));
// Neither entered by nor assigned to i-1 (ownTicket is entered_by 'x', unassigned).
const mspOwnComment = (ticket_id: string) => ({ comment_id: 'c-1', ticket_id, user_id: 'i-1', note: 'x', is_internal: false, tenant: 'tenant-1' });

describe('comment mutations: client principals need record access to the owning ticket', () => {
  beforeEach(() => {
    writes = [];
    listRows = {};
    vi.mocked(ticketAuthz.authorizeTicketRecordAccessConcealed).mockClear();
    commentInsert.mockReset().mockResolvedValue('new-comment-id');
    commentAuthorType = 'client';
    parentThreadRow = null;
    bundleRules = [];
    currentUser = client;
    ticketRow = foreignTicket;
    commentRow = ownComment('ticket-2');
    hasPermissionMock.mockReset().mockResolvedValue(true);
    commentUpdate.mockReset();
    commentDelete.mockReset().mockImplementation(() => {
      writes.push({ table: 'comments', op: 'delete' });
    });
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

  it('deleteComment: clears email reply references before deleting the comment', async () => {
    ticketRow = ownTicket;
    commentRow = ownComment('ticket-1');

    await deleteComment('c-1');

    expect(writes).toEqual([
      { table: 'comment_reactions', op: 'delete' },
      { table: 'email_reply_tokens', op: 'update' },
      { table: 'comments', op: 'delete' },
    ]);
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
    listRows = { comments: [commentRow] };
    await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
  });

  describe('bundle-restricted MSP principals (own_or_assigned)', () => {
    const DENIED = 'Permission denied: Cannot access ticket';
    beforeEach(() => {
      currentUser = mspUser;
      bundleRules = ownOrAssignedRules;
      ticketRow = ownTicket; // not entered by / assigned to i-1
      commentRow = mspOwnComment('ticket-1');
      listRows = { comments: [commentRow] };
    });

    it('updateComment: denies an MSP author editing a comment on a ticket they cannot see', async () => {
      const result: any = await updateComment('c-1', { note: 'edited' }).catch((e) => e);
      expect(result?.actionError).toContain('Ticket not found');
      expect(commentUpdate).not.toHaveBeenCalled();
    });

    it('updateComment: allows an MSP author on an assigned ticket', async () => {
      ticketRow = { ...ownTicket, assigned_to: 'i-1' };
      await updateComment('c-1', { note: 'edited' });
      expect(commentUpdate).toHaveBeenCalledTimes(1);
    });

    it('deleteComment: denies an MSP author deleting a comment on a ticket they cannot see', async () => {
      const result: any = await deleteComment('c-1').catch((e) => e);
      expect(result?.actionError).toContain('Ticket not found');
      expect(commentDelete).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('toggleCommentReaction: denies an MSP user reacting on a ticket they cannot see', async () => {
      const result: any = await toggleCommentReaction('c-1', '👍').catch((e) => e);
      expect(String(result?.message ?? result)).toMatch(/Permission denied/);
      expect(writes).toEqual([]);
    });

    it('toggleCommentReaction: gives an MSP user the same denial for a missing comment', async () => {
      commentRow = null;
      listRows = { comments: [] };
      const result: any = await toggleCommentReaction('c-missing', '👍').catch((e) => e);
      expect(String(result?.message ?? result)).toMatch(/Permission denied/);
    });

    it('toggleCommentReaction: allows an MSP user on an assigned ticket', async () => {
      ticketRow = { ...ownTicket, assigned_to: 'i-1' };
      await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
    });
  });

  it('toggleCommentReaction: internal MSP users are now ticket-authorized (update) and may react to internal comments', async () => {
    currentUser = { user_id: 'i-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
    bundleRules = [];
    ticketRow = { ...ownTicket, assigned_to: 'i-1' };
    commentRow = { ...ownComment('ticket-1'), is_internal: true };
    listRows = { comments: [commentRow] };
    await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
  });

  describe('toggleCommentReaction: comment-level visibility for clients', () => {
    beforeEach(() => { ticketRow = ownTicket; });
    const deniedFor = async (overrides: Record<string, unknown>, thread?: Record<string, unknown>) => {
      commentRow = { ...ownComment('ticket-1'), ...overrides };
      listRows = { comments: [commentRow], comment_threads: thread ? [thread] : [] };
      const result: any = await toggleCommentReaction('c-1', '👍').catch((e) => e);
      expect(String(result?.message ?? result)).toBe('Permission denied: Cannot access ticket');
      expect(writes).toEqual([]);
    };
    const allowedFor = async (overrides: Record<string, unknown>) => {
      commentRow = { ...ownComment('ticket-1'), ...overrides };
      listRows = { comments: [commentRow], comment_threads: [{ thread_id: 'th-1', is_internal: false }] };
      await expect(toggleCommentReaction('c-1', '👍')).resolves.toEqual({ added: true });
    };

    it('denies an internal comment on a ticket the client can see (no insert)', async () => {
      await deniedFor({ is_internal: true });
    });
    it('denies a comment in an internal thread', async () => {
      await deniedFor({}, { thread_id: 'th-1', is_internal: true });
    });
    it('denies an unpublished (scheduled) comment', async () => {
      await deniedFor({ publish_state: 'scheduled' });
    });
    it('denies a soft-deleted comment', async () => {
      await deniedFor({ deleted_at: '2030-01-01T00:00:00Z' });
    });
    it('allows a published, non-internal requester-audience comment (collaboration_audience requester <=> is_internal false)', async () => {
      await allowedFor({ is_internal: false });
    });
    it('fails closed for a comment with no ticket', async () => {
      await deniedFor({ ticket_id: null });
    });
  });

  describe('getCommentsReactionsBatch', () => {
    const visible = { ...ownComment('ticket-1'), comment_id: 'c-vis' };
    const hidden = { ...ownComment('ticket-1'), comment_id: 'c-hid', is_internal: true };
    beforeEach(() => {
      ticketRow = ownTicket;
      createTenantKnexMock.mockResolvedValue({ knex: makeTrx(), tenant: 'tenant-1' });
      listRows = {
        comments: [visible, hidden],
        comment_threads: [{ thread_id: 'th-1', is_internal: false }],
        comment_reactions: [{ comment_id: 'c-vis', emoji: '👍', user_id: 'u-a' }],
        users: [{ user_id: 'u-a', first_name: 'Ann', last_name: 'A' }],
      };
    });

    it('returns reactions only for the visible comment and no names from the hidden one', async () => {
      const result = await getCommentsReactionsBatch(['c-vis', 'c-hid']);
      expect(Object.keys(result.reactions)).toEqual(['c-vis']);
      expect(Object.keys(result.userNames)).toEqual(['u-a']);
    });

    it('queries reactions only for authorized IDs', async () => {
      const seen: any[] = [];
      const trx = makeTrx();
      listRows.comment_reactions = [
        { comment_id: 'c-vis', emoji: '👍', user_id: 'u-a' },
        { comment_id: 'c-hid', emoji: '🎉', user_id: 'u-secret' },
      ];
      // The fake returns whatever rows we list, so assert on the filter argument instead.
      const origTable = trx;
      const wrapped: any = (t: string) => {
        const b = origTable(t);
        if (t !== 'comment_reactions') return b;
        return new Proxy(b, { get(target, prop: string) {
          if (prop === 'whereIn') return (...a: any[]) => { seen.push(a); return target; };
          return target[prop];
        } });
      };
      createTenantKnexMock.mockResolvedValue({ knex: wrapped, tenant: 'tenant-1' });
      await getCommentsReactionsBatch(['c-vis', 'c-hid']);
      expect(seen[0]).toEqual(['comment_id', ['c-vis']]);
    });

    it('returns empty (no throw) for comments on a ticket the caller cannot see', async () => {
      ticketRow = foreignTicket;
      listRows.comments = [{ ...visible, ticket_id: 'ticket-2' }];
      await expect(getCommentsReactionsBatch(['c-vis'])).resolves.toEqual({ reactions: {}, userNames: {} });
    });

    it('returns empty for missing IDs', async () => {
      listRows.comments = [];
      await expect(getCommentsReactionsBatch(['nope'])).resolves.toEqual({ reactions: {}, userNames: {} });
    });

    it('authorizes once per ticket, not once per comment', async () => {
      listRows.comments = ['a', 'b', 'c'].map((id) => ({ ...visible, comment_id: id }));
      await getCommentsReactionsBatch(['a', 'b', 'c']);
      const spy = vi.mocked(ticketAuthz.authorizeTicketRecordAccessConcealed);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ ticketId: 'ticket-1', action: 'read' });
    });
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

    it('denies a bundle-restricted MSP user on a ticket they cannot see, with the nonexistent-ticket denial, and inserts nothing', async () => {
      currentUser = mspUser;
      commentAuthorType = 'internal';
      bundleRules = ownOrAssignedRules;
      ticketRow = null;
      const missing = await outcome(newComment('ticket-nope'));
      ticketRow = foreignTicket; // not entered by / assigned to i-1
      parentThreadRow = { thread_is_internal: true };
      const denied = await outcome(newComment('ticket-2', { parent_comment_id: 'p-1' }));
      expect((missing as any).returned.actionError).toContain('Ticket not found');
      expect(denied).toEqual(missing);
      expect(commentInsert).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('fails closed for any principal when ticket_id is missing', async () => {
      currentUser = mspUser;
      commentAuthorType = 'internal';
      const result = await outcome(newComment(undefined as any));
      expect(JSON.stringify(result)).toMatch(/ticket_id is required/);
      expect(commentInsert).not.toHaveBeenCalled();
    });

    it('allows an MSP user on an assigned ticket and inserts as author_type internal', async () => {
      currentUser = mspUser;
      commentAuthorType = 'internal';
      bundleRules = ownOrAssignedRules;
      ticketRow = { ...foreignTicket, assigned_to: 'i-1' };
      const result: any = await outcome(newComment('ticket-2'));
      expect(result.returned).toBe('new-comment-id');
      expect(commentInsert.mock.calls[0][2]).toMatchObject({ author_type: 'internal' });
    });
  });
});

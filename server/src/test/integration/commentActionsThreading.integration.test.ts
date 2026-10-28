import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { tenantDb } from '@alga-psa/db';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

const publishEventMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  // Comment publication outbox replays through publishStoredWorkflowEvent; keep the assertions on the comment event.
  publishStoredWorkflowEvent: (...args: any[]) => publishEventMock(...args),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', () => ({
  publishTicketUpdate: vi.fn(),
}));

import { hasPermission } from '@alga-psa/auth';
import { createComment, deleteComment, updateComment } from '../../../../packages/tickets/src/actions/comment-actions/commentActions';
import {
  registerCommentEventContributor,
  resetCommentEventContributors,
  type CommentEventEnvelope,
} from '@alga-psa/db/commentEventRegistry';

const blockNote = (text: string) => JSON.stringify([
  {
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
  },
]);

describe('ticket comment threading actions', () => {
  let knex: Knex;

  function scopedDb(tenant = dbRef.tenant) {
    return tenantDb(knex, tenant);
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const contextQuery = discoveryDb.unscoped(
      'tickets as t',
      'test discovery of seeded ticket/user context for comment threading actions'
    );
    discoveryDb.tenantJoin(contextQuery, 'users as u', 'u.tenant', 't.tenant', {
      on: (join) => join.andOnVal('u.user_type', 'internal'),
    });
    const context = await contextQuery
      .select('t.tenant', 'u.user_id', 'u.first_name', 'u.last_name')
      .first();
    expect(context).toBeTruthy();
    dbRef.knex = knex;
    dbRef.tenant = context.tenant;
    userRef.user = {
      user_id: context.user_id,
      user_type: 'internal',
      first_name: context.first_name,
      last_name: context.last_name,
    };
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T027: createComment accepts parent_comment_id and forwards it to the model', async () => {
    const context = await scopedDb().table('tickets')
      .select('tenant', 'ticket_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createComment({
      ticket_id: context.ticket_id,
      user_id: userRef.user.user_id,
      note: blockNote('Root ticket comment from action threading test'),
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('comments')
        .select('thread_id')
        .where({ comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentId = await createComment({
        ticket_id: context.ticket_id,
        user_id: userRef.user.user_id,
        note: blockNote('Reply ticket comment from action threading test'),
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      const reply = await scopedDb(context.tenant).table('comments')
        .select('thread_id', 'parent_comment_id')
        .where({ comment_id: replyCommentId })
        .first();
      expect(reply).toMatchObject({
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });
    } finally {
      if (replyCommentId) {
        await scopedDb(context.tenant).table('comments').where({ comment_id: replyCommentId }).delete();
      }
      await scopedDb(context.tenant).table('comments').where({ comment_id: rootCommentId }).delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads').where({ thread_id: threadId }).delete();
      }
    }
  });

  it('T028: TICKET_COMMENT_ADDED payload includes reply threading fields', async () => {
    const context = await scopedDb().table('tickets')
      .select('tenant', 'ticket_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createComment({
      ticket_id: context.ticket_id,
      user_id: userRef.user.user_id,
      note: blockNote('Root ticket comment for event payload test'),
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('comments')
        .select('thread_id')
        .where({ comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      publishEventMock.mockClear();
      replyCommentId = await createComment({
        ticket_id: context.ticket_id,
        user_id: userRef.user.user_id,
        note: blockNote('Reply ticket comment for event payload test'),
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      const addedEvent = publishEventMock.mock.calls
        .map(([event]) => event)
        .find((event) => event.eventType === 'TICKET_COMMENT_ADDED');
      expect(addedEvent).toBeTruthy();
      expect(addedEvent.payload).toMatchObject({
        tenantId: context.tenant,
        ticketId: context.ticket_id,
        userId: userRef.user.user_id,
        thread_id: threadId,
        parent_comment_id: rootCommentId,
        is_reply: true,
        comment: {
          id: replyCommentId,
          thread_id: threadId,
          parent_comment_id: rootCommentId,
          is_reply: true,
        },
      });
    } finally {
      if (replyCommentId) {
        await scopedDb(context.tenant).table('comments').where({ comment_id: replyCommentId }).delete();
      }
      await scopedDb(context.tenant).table('comments').where({ comment_id: rootCommentId }).delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads').where({ thread_id: threadId }).delete();
      }
    }
  });

  it('T029: client users cannot create internal replies', async () => {
    const context = await scopedDb().table('tickets')
      .select('tenant', 'ticket_id')
      .first();
    expect(context).toBeTruthy();

    let clientUser = await scopedDb(context.tenant).table('users')
      .select('user_id')
      .where({ user_type: 'client' })
      .first();

    let createdClientUserId: string | undefined;
    if (!clientUser) {
      const [createdClientUser] = await scopedDb(context.tenant).table('users')
        .insert({
          tenant: context.tenant,
          username: `thread-client-${Date.now()}`,
          hashed_password: 'not-used',
          first_name: 'Thread',
          last_name: 'Client',
          email: `thread-client-${Date.now()}@example.test`,
          user_type: 'client',
        })
        .returning('user_id');
      createdClientUserId = createdClientUser.user_id;
      clientUser = { user_id: createdClientUserId };
    }

    const rootCommentId = await createComment({
      ticket_id: context.ticket_id,
      user_id: userRef.user.user_id,
      note: blockNote('Root ticket comment for client RBAC test'),
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('comments')
        .select('thread_id')
        .where({ comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      // Comment authorship is the authenticated user (callers cannot pass
      // another user_id), so the denial must come from a client session.
      const mspUser = userRef.user;
      userRef.user = { user_id: clientUser.user_id, user_type: 'client' };
      let deniedInternalReply;
      try {
        deniedInternalReply = await createComment({
          ticket_id: context.ticket_id,
          user_id: clientUser.user_id,
          note: blockNote('Invalid internal reply from client user'),
          is_internal: true,
          is_resolution: false,
          parent_comment_id: rootCommentId,
        });
      } finally {
        userRef.user = mspUser;
      }
      expect(deniedInternalReply).toMatchObject({
        actionError: 'Only MSP users can create internal comments',
      });

      const invalidReply = await scopedDb(context.tenant).table('comments')
        .select('comment_id')
        .where({
          ticket_id: context.ticket_id,
          user_id: clientUser.user_id,
          parent_comment_id: rootCommentId,
          is_internal: true,
        })
        .first();
      expect(invalidReply).toBeUndefined();
    } finally {
      await scopedDb(context.tenant).table('comments').where({ parent_comment_id: rootCommentId }).delete();
      await scopedDb(context.tenant).table('comments').where({ comment_id: rootCommentId }).delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads').where({ thread_id: threadId }).delete();
      }
      if (createdClientUserId) {
        await scopedDb(context.tenant).table('users').where({ user_id: createdClientUserId }).delete();
      }
    }
  });

  it('T078: client reply RBAC allows own client-visible thread and rejects internal or inaccessible threads', async () => {
    const tenantScoped = scopedDb();
    const contextQuery = tenantScoped.table('tickets as t');
    tenantScoped.tenantJoin(contextQuery, 'users as u', 'u.tenant', 't.tenant', {
      on: (join) => join.andOnVal('u.user_type', 'internal'),
    });
    const context = await contextQuery
      .select(
        't.tenant',
        't.ticket_id',
        't.client_id',
        't.status_id',
        't.priority_id',
        't.board_id',
        'u.user_id as internal_user_id'
      )
      .whereNotNull('t.client_id')
      .first();
    expect(context).toBeTruthy();

    const generated = await knex.raw(`
      SELECT
        gen_random_uuid() AS client_user_id,
        gen_random_uuid() AS other_client_id,
        gen_random_uuid() AS other_ticket_id
    `);
    const ids = generated.rows[0];
    const originalUser = userRef.user;
    let clientVisibleRootId: string | undefined;
    let internalRootId: string | undefined;
    let inaccessibleRootId: string | undefined;
    let allowedReplyId: string | undefined;

    await scopedDb(context.tenant).table('clients').insert({
      tenant: context.tenant,
      client_id: ids.other_client_id,
      client_name: `T078 Other Client ${Date.now()}`,
      billing_cycle: 'monthly',
    });

    await scopedDb(context.tenant).table('tickets').insert({
      tenant: context.tenant,
      ticket_id: ids.other_ticket_id,
      ticket_number: `T078-${Date.now()}`,
      title: 'T078 inaccessible client ticket',
      status_id: context.status_id,
      priority_id: context.priority_id,
      board_id: context.board_id,
      client_id: ids.other_client_id,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    await scopedDb(context.tenant).table('users').insert({
      tenant: context.tenant,
      user_id: ids.client_user_id,
      username: `t078-client-${Date.now()}`,
      hashed_password: 'not-used',
      first_name: 'T078',
      last_name: 'Client',
      email: `t078-client-${Date.now()}@example.test`,
      user_type: 'client',
    });

    try {
      clientVisibleRootId = await createComment({
        ticket_id: context.ticket_id,
        user_id: context.internal_user_id,
        note: blockNote('T078 client-visible root'),
        is_internal: false,
        is_resolution: false,
      });

      internalRootId = await createComment({
        ticket_id: context.ticket_id,
        user_id: context.internal_user_id,
        note: blockNote('T078 internal root'),
        is_internal: true,
        is_resolution: false,
      });

      inaccessibleRootId = await createComment({
        ticket_id: ids.other_ticket_id,
        user_id: context.internal_user_id,
        note: blockNote('T078 inaccessible root'),
        is_internal: false,
        is_resolution: false,
      });

      userRef.user = {
        user_id: ids.client_user_id,
        user_type: 'client',
        first_name: 'T078',
        last_name: 'Client',
        clientId: context.client_id,
      };

      allowedReplyId = await createComment({
        ticket_id: context.ticket_id,
        user_id: ids.client_user_id,
        note: blockNote('T078 allowed client reply'),
        is_internal: false,
        is_resolution: false,
        parent_comment_id: clientVisibleRootId,
      });

      const allowedReply = await scopedDb(context.tenant).table('comments')
        .select('comment_id', 'author_type', 'is_internal', 'parent_comment_id')
        .where({ comment_id: allowedReplyId })
        .first();
      expect(allowedReply).toMatchObject({
        comment_id: allowedReplyId,
        author_type: 'client',
        is_internal: false,
        parent_comment_id: clientVisibleRootId,
      });

      const deniedInternalThreadReply = await createComment({
        ticket_id: context.ticket_id,
        user_id: ids.client_user_id,
        note: blockNote('T078 denied internal-thread reply'),
        is_internal: false,
        is_resolution: false,
        parent_comment_id: internalRootId,
      });
      expect(deniedInternalThreadReply).toMatchObject({
        actionError: 'Reply visibility must match the thread root visibility',
      });
      // A denied portal reply must not be stored at all -- not even re-rooted
      // into a fresh public thread the way inbound email replies are.
      const clientAuthoredIds = await scopedDb(context.tenant).table('comments')
        .where({ user_id: ids.client_user_id })
        .pluck('comment_id');
      expect(clientAuthoredIds).toEqual([allowedReplyId]);

      const deniedInaccessibleReply = await createComment({
        ticket_id: ids.other_ticket_id,
        user_id: ids.client_user_id,
        note: blockNote('T078 denied inaccessible ticket reply'),
        is_internal: false,
        is_resolution: false,
        parent_comment_id: inaccessibleRootId,
      });
      expect(deniedInaccessibleReply).toMatchObject({
        actionError: 'Client user cannot access this ticket',
      });
    } finally {
      userRef.user = originalUser;
      // Remove anything the client user authored, including comments a
      // regression stored outside the seeded threads, so cleanup cannot mask
      // the real assertion with a users FK violation.
      const strayClientComments = await scopedDb(context.tenant).table('comments')
        .where({ user_id: ids.client_user_id })
        .select('comment_id', 'thread_id');
      await scopedDb(context.tenant).table('comments')
        .where({ user_id: ids.client_user_id })
        .delete();
      await scopedDb(context.tenant).table('comment_threads')
        .whereIn('root_comment_id', strayClientComments.map((row: any) => row.comment_id))
        .delete();
      await scopedDb(context.tenant).table('comments')
        .whereIn('parent_comment_id', [clientVisibleRootId, internalRootId, inaccessibleRootId].filter(Boolean))
        .delete();
      await scopedDb(context.tenant).table('comments')
        .whereIn('comment_id', [clientVisibleRootId, internalRootId, inaccessibleRootId].filter(Boolean))
        .delete();
      await scopedDb(context.tenant).table('comment_threads')
        .whereIn('root_comment_id', [clientVisibleRootId, internalRootId, inaccessibleRootId].filter(Boolean))
        .delete();
      // createComment writes ticket_audit_logs rows whose FKs block user/ticket deletion.
      await scopedDb(context.tenant).table('ticket_audit_logs').where({ actor_user_id: ids.client_user_id }).delete();
      await scopedDb(context.tenant).table('ticket_audit_logs').where({ ticket_id: ids.other_ticket_id }).delete();
      await scopedDb(context.tenant).table('users').where({ user_id: ids.client_user_id }).delete();
      await scopedDb(context.tenant).table('tickets').where({ ticket_id: ids.other_ticket_id }).delete();
      await scopedDb(context.tenant).table('clients').where({ client_id: ids.other_client_id }).delete();
    }
  });

  it('refuses to let a user without ticket:update change a comment nobody authored', async () => {
    // The author-less repair path is gated on ticket:update; without it an
    // internal user is treated like any other non-author.
    const ticket = await scopedDb().table('tickets').select('ticket_id').first();
    const author = userRef.user;
    const commentId = await createComment({ ticket_id: ticket.ticket_id, user_id: author.user_id,
      note: blockNote('Inbound text'), is_internal: false, is_resolution: false });
    await scopedDb().table('comments').where({ comment_id: commentId }).update({ user_id: null });
    const other = { ...author, user_id: randomUUID() };
    await scopedDb().table('users').insert({ tenant: dbRef.tenant, user_id: other.user_id, username: `noupd-${other.user_id}`,
      email: `noupd-${other.user_id}@example.test`, first_name: 'No', last_name: 'Update', hashed_password: 'not-a-login',
      user_type: 'internal', is_inactive: false });
    const permission = vi.mocked(hasPermission);
    try {
      permission.mockImplementation(async (_user: any, resource: string, action: string) =>
        !(resource === 'ticket' && action === 'update'));
      userRef.user = other;
      await expect(updateComment(commentId, { note: blockNote('Rewritten without ticket:update') }))
        .resolves.toMatchObject({ actionError: 'You can only edit your own comments' });
      await expect(deleteComment(commentId)).resolves.toMatchObject({ actionError: 'You can only edit your own comments' });
      expect(permission).toHaveBeenCalledWith(expect.objectContaining({ user_id: other.user_id }), 'ticket', 'update', expect.anything());
      const stored = await scopedDb().table('comments').where({ comment_id: commentId }).first();
      expect(stored).toBeTruthy();
      expect(stored.note).toContain('Inbound text');
    } finally {
      permission.mockImplementation(async () => true);
      userRef.user = author;
      await scopedDb().table('comments').where({ comment_id: commentId }).delete();
      await scopedDb().table('users').where({ user_id: other.user_id }).delete();
    }
  });

  it('refuses a customer-side caller who submits is_internal on their own comment', async () => {
    const ticket = await scopedDb().table('tickets').select('ticket_id').first();
    const author = userRef.user;
    const clientUserId = randomUUID();
    await scopedDb().table('users').insert({ tenant: dbRef.tenant, user_id: clientUserId, username: `cli-int-${clientUserId}`,
      email: `cli-int-${clientUserId}@example.test`, first_name: 'Portal', last_name: 'Client', hashed_password: 'not-a-login',
      user_type: 'client', is_inactive: false });
    const commentId = await createComment({ ticket_id: ticket.ticket_id, user_id: author.user_id,
      note: blockNote('Client visible text'), is_internal: false, is_resolution: false });
    await scopedDb().table('comments').where({ comment_id: commentId }).update({ user_id: clientUserId, author_type: 'client' });
    try {
      userRef.user = { user_id: clientUserId, user_type: 'client', first_name: 'Portal', last_name: 'Client' };
      await expect(updateComment(commentId, { note: blockNote('Now hidden from my own portal'), is_internal: true }))
        .resolves.toMatchObject({ actionError: 'Only MSP users can set comments as internal' });
      const stored = await scopedDb().table('comments').where({ comment_id: commentId }).first();
      expect(stored.is_internal).toBe(false);
      expect(stored.note).toContain('Client visible text');

      // Control: resubmitting the unchanged flag alongside a text edit is not a change and is accepted.
      const edited = await updateComment(commentId, { note: blockNote('Edited by the client'), is_internal: false });
      expect((edited as { actionError?: string } | undefined)?.actionError).toBeUndefined();
      const after = await scopedDb().table('comments').where({ comment_id: commentId }).first();
      expect(after.note).toContain('Edited by the client');
      expect(after.is_internal).toBe(false);
    } finally {
      userRef.user = author;
      await scopedDb().table('comments').where({ comment_id: commentId }).delete();
      await scopedDb().table('ticket_audit_logs').where({ actor_user_id: clientUserId }).delete();
      await scopedDb().table('users').where({ user_id: clientUserId }).delete();
    }
  });

  it('lets only the author change a comment, and only its text and flags', async () => {
    // updateComment checked the user_id in the request body, not the caller,
    // and passed every other field through: anyone could rewrite, backdate or
    // undelete another user's comment by leaving user_id out.
    const ticket = await scopedDb().table('tickets').select('ticket_id').first();
    const author = userRef.user;
    const commentId = await createComment({ ticket_id: ticket.ticket_id, user_id: author.user_id,
      note: blockNote('Original text'), is_internal: false, is_resolution: false });
    const other = { ...author, user_id: randomUUID() };
    await scopedDb().table('users').insert({ tenant: dbRef.tenant, user_id: other.user_id, username: `other-${other.user_id}`,
      email: `other-${other.user_id}@example.test`, first_name: 'Other', last_name: 'Tech', hashed_password: 'not-a-login',
      user_type: 'internal', is_inactive: false });
    try {
      userRef.user = other;
      await expect(updateComment(commentId, { note: blockNote('Rewritten by someone else') }))
        .resolves.toMatchObject({ actionError: 'You can only edit your own comments' });
      await expect(deleteComment(commentId)).resolves.toMatchObject({ actionError: 'You can only edit your own comments' });
      expect((await scopedDb().table('comments').where({ comment_id: commentId }).first()).note).toContain('Original text');

      userRef.user = author;
      publishEventMock.mockClear();
      await updateComment(commentId, { note: blockNote('Corrected by the author'), created_at: '2020-01-01T00:00:00Z',
        user_id: other.user_id, deleted_at: null, publish_state: 'scheduled' } as any);
      const stored = await scopedDb().table('comments').where({ comment_id: commentId }).first();
      expect(stored.note).toContain('Corrected by the author');
      expect(stored.user_id).toBe(author.user_id);
      expect(new Date(stored.created_at).getFullYear()).not.toBe(2020);
      expect(stored.publish_state).not.toBe('scheduled');

      // The edit must still notify: the event is no longer keyed on a body-supplied user_id.
      const updatedEvent = publishEventMock.mock.calls
        .map(([event]) => event)
        .find((event) => event?.eventType === 'TICKET_COMMENT_UPDATED');
      expect(updatedEvent).toBeTruthy();
      expect(updatedEvent.payload).toMatchObject({ userId: author.user_id, ticketId: ticket.ticket_id });
      expect(updatedEvent.payload.newComment.id).toBe(commentId);

      // A comment nobody authored (inbound email) may be corrected by someone who updates tickets.
      await scopedDb().table('comments').where({ comment_id: commentId }).update({ user_id: null });
      userRef.user = other;
      publishEventMock.mockClear();
      const retained: CommentEventEnvelope[] = [];
      registerCommentEventContributor({ name: 'test-capture', retain: async (_trx, envelope) => {
        retained.push(envelope);
        return false;
      } });
      const fixed = await updateComment(commentId, { note: blockNote('Fixed inbound text') });
      expect((fixed as { actionError?: string } | undefined)?.actionError).toBeUndefined();
      expect((await scopedDb().table('comments').where({ comment_id: commentId }).first()).note).toContain('Fixed inbound text');

      // Editing does not change authorship: the corrector is the actor, not the new author.
      const repairEvent = publishEventMock.mock.calls
        .map(([event]) => event)
        .find((event) => event?.eventType === 'TICKET_COMMENT_UPDATED');
      expect(repairEvent.payload.userId).toBe(other.user_id);
      expect(repairEvent.payload.oldComment.author).toBe('Unknown User');
      expect(repairEvent.payload.newComment.author).toBe('Unknown User');
      expect(retained).toEqual([{ source: 'ticket', event: expect.objectContaining({
        eventType: 'TICKET_COMMENT_UPDATED', commentId, ticketId: ticket.ticket_id, userId: other.user_id,
      }) }]);
    } finally {
      resetCommentEventContributors();
      userRef.user = author;
      await scopedDb().table('comments').where({ comment_id: commentId }).delete();
      await scopedDb().table('users').where({ user_id: other.user_id }).update({ is_inactive: true });
    }
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
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
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', () => ({
  publishTicketUpdate: vi.fn(),
}));

import { createComment } from '../../../../packages/tickets/src/actions/comment-actions/commentActions';

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

      const deniedInternalReply = await createComment({
        ticket_id: context.ticket_id,
        user_id: clientUser.user_id,
        note: blockNote('Invalid internal reply from client user'),
        is_internal: true,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });
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
});

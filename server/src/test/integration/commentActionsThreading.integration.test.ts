import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

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

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const context = await knex('tickets as t')
      .join('users as u', function() {
        this.on('u.tenant', 't.tenant').andOnVal('u.user_type', 'internal');
      })
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
    const context = await knex('tickets')
      .select('tenant', 'ticket_id')
      .where({ tenant: dbRef.tenant })
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
      const root = await knex('comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
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

      const reply = await knex('comments')
        .select('thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, comment_id: replyCommentId })
        .first();
      expect(reply).toMatchObject({
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });
    } finally {
      if (replyCommentId) {
        await knex('comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await knex('comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await knex('comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T028: TICKET_COMMENT_ADDED payload includes reply threading fields', async () => {
    const context = await knex('tickets')
      .select('tenant', 'ticket_id')
      .where({ tenant: dbRef.tenant })
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
      const root = await knex('comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
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
        await knex('comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await knex('comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await knex('comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T029: client users cannot create internal replies', async () => {
    const context = await knex('tickets')
      .select('tenant', 'ticket_id')
      .where({ tenant: dbRef.tenant })
      .first();
    expect(context).toBeTruthy();

    let clientUser = await knex('users')
      .select('user_id')
      .where({ tenant: context.tenant, user_type: 'client' })
      .first();

    let createdClientUserId: string | undefined;
    if (!clientUser) {
      const [createdClientUser] = await knex('users')
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
      const root = await knex('comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      await expect(createComment({
        ticket_id: context.ticket_id,
        user_id: clientUser.user_id,
        note: blockNote('Invalid internal reply from client user'),
        is_internal: true,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      })).rejects.toThrow('Failed to create comment');

      const invalidReply = await knex('comments')
        .select('comment_id')
        .where({
          tenant: context.tenant,
          ticket_id: context.ticket_id,
          user_id: clientUser.user_id,
          parent_comment_id: rootCommentId,
          is_internal: true,
        })
        .first();
      expect(invalidReply).toBeUndefined();
    } finally {
      await knex('comments').where({ tenant: context.tenant, parent_comment_id: rootCommentId }).delete();
      await knex('comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await knex('comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
      if (createdClientUserId) {
        await knex('users').where({ tenant: context.tenant, user_id: createdClientUserId }).delete();
      }
    }
  });
});

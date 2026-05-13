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
});

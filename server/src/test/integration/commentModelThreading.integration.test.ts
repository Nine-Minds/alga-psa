import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

describe('ticket comment threading model', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T014: creates a new comment thread for a top-level ticket comment', async () => {
    const context = await knex('tickets as t')
      .join('users as u', 'u.tenant', 't.tenant')
      .select('t.tenant', 't.ticket_id', 'u.user_id')
      .first();
    expect(context).toBeTruthy();

    const commentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Top-level comment created by model threading test',
      markdown_content: 'Top-level comment created by model threading test',
      is_internal: false,
      is_resolution: false,
    });

    try {
      const comment = await knex('comments')
        .select('comment_id', 'thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      expect(comment?.thread_id).toBeTruthy();
      expect(comment?.parent_comment_id).toBeNull();

      const thread = await knex('comment_threads')
        .select('thread_id', 'ticket_id', 'project_task_id', 'root_comment_id', 'reply_count')
        .where({ tenant: context.tenant, thread_id: comment.thread_id })
        .first();
      expect(thread).toMatchObject({
        thread_id: comment.thread_id,
        ticket_id: context.ticket_id,
        project_task_id: null,
        root_comment_id: commentId,
        reply_count: 0,
      });
    } finally {
      const comment = await knex('comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      await knex('comments').where({ tenant: context.tenant, comment_id: commentId }).delete();
      if (comment?.thread_id) {
        await knex('comment_threads').where({ tenant: context.tenant, thread_id: comment.thread_id }).delete();
      }
    }
  });

  it('T015: replies inherit the parent comment thread', async () => {
    const context = await knex('tickets as t')
      .join('users as u', 'u.tenant', 't.tenant')
      .select('t.tenant', 't.ticket_id', 'u.user_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for reply inheritance test',
      markdown_content: 'Root comment for reply inheritance test',
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

      replyCommentId = await Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Reply comment for inheritance test',
        markdown_content: 'Reply comment for inheritance test',
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

  it('T016: rejects replies whose parent belongs to a different ticket', async () => {
    const tenant = await knex('tenants').select('tenant').first();
    expect(tenant).toBeTruthy();

    const user = await knex('users')
      .select('user_id')
      .where({ tenant: tenant.tenant })
      .first();
    expect(user).toBeTruthy();

    const tickets = await knex('tickets')
      .select('tenant', 'ticket_id')
      .where({ tenant: tenant.tenant })
      .orderBy('ticket_id')
      .limit(2);
    expect(tickets).toHaveLength(2);

    const [parentTicket, otherTicket] = tickets;
    const parentContext = { ...parentTicket, user_id: user.user_id };
    const otherTicketContext = { ...otherTicket, user_id: user.user_id };
    const parentCommentId = await Comment.insert(knex, parentContext.tenant, {
      ticket_id: parentContext.ticket_id,
      user_id: parentContext.user_id,
      author_type: 'internal',
      note: 'Parent comment on first ticket',
      markdown_content: 'Parent comment on first ticket',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;

    try {
      const parent = await knex('comments')
        .select('thread_id')
        .where({ tenant: parentContext.tenant, comment_id: parentCommentId })
        .first();
      threadId = parent.thread_id;

      await expect(Comment.insert(knex, otherTicketContext.tenant, {
        ticket_id: otherTicketContext.ticket_id,
        user_id: otherTicketContext.user_id,
        author_type: 'internal',
        note: 'Invalid cross-ticket reply',
        markdown_content: 'Invalid cross-ticket reply',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: parentCommentId,
      })).rejects.toThrow('Parent comment must belong to the same ticket');
    } finally {
      await knex('comments').where({ tenant: parentContext.tenant, parent_comment_id: parentCommentId }).delete();
      await knex('comments').where({ tenant: parentContext.tenant, comment_id: parentCommentId }).delete();
      if (threadId) {
        await knex('comment_threads').where({ tenant: parentContext.tenant, thread_id: threadId }).delete();
      }
    }
  });
});

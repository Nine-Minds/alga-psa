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
});

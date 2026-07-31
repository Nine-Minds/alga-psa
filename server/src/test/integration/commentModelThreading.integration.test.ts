import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

describe('ticket comment threading model', () => {
  let knex: Knex;

  function scopedDb(tenant: string) {
    return tenantDb(knex, tenant);
  }

  function tenantTable(tenant: string, table: string) {
    return scopedDb(tenant).table(table);
  }

  async function ticketUserContext() {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const query = discoveryDb.unscoped(
      'tickets as t',
      'test discovery of seeded ticket/user context for comment model threading'
    );
    discoveryDb.tenantJoin(query, 'users as u', 'u.tenant', 't.tenant');
    return query
      .select('t.tenant', 't.ticket_id', 'u.user_id')
      .first();
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T014: creates a new comment thread for a top-level ticket comment', async () => {
    const context = await ticketUserContext();
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
      const comment = await tenantTable(context.tenant, 'comments')
        .select('comment_id', 'thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      expect(comment?.thread_id).toBeTruthy();
      expect(comment?.parent_comment_id).toBeNull();

      const thread = await tenantTable(context.tenant, 'comment_threads')
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
      const comment = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: commentId }).delete();
      if (comment?.thread_id) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: comment.thread_id }).delete();
      }
    }
  });

  it('T015: replies inherit the parent comment thread', async () => {
    const context = await ticketUserContext();
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
      const root = await tenantTable(context.tenant, 'comments')
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

      const reply = await tenantTable(context.tenant, 'comments')
        .select('thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, comment_id: replyCommentId })
        .first();
      expect(reply).toMatchObject({
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });
    } finally {
      if (replyCommentId) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T016: rejects replies whose parent belongs to a different ticket', async () => {
    const tenant = await tenantDb(knex, '__test_discovery__')
      .unscoped('tenants', 'test discovery of seeded tenant for cross-ticket comment threading')
      .select('tenant')
      .first();
    expect(tenant).toBeTruthy();

    const user = await tenantTable(tenant.tenant, 'users')
      .select('user_id')
      .where({ tenant: tenant.tenant })
      .first();
    expect(user).toBeTruthy();

    const tickets = await tenantTable(tenant.tenant, 'tickets')
      .select('tenant', 'ticket_id')
      .where({ tenant: tenant.tenant })
      .orderBy('ticket_id')
      .limit(2);
    expect(tickets).toHaveLength(2);

    const [parentTicket, otherTicket] = tickets;
    const parentContext = { ...parentTicket, user_id: user.user_id };
    const otherTicketContext = { ...otherTicket, user_id: user.user_id };
    const context = parentContext;
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
      const parent = await tenantTable(context.tenant, 'comments')
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
      await tenantTable(context.tenant, 'comments').where({ tenant: parentContext.tenant, parent_comment_id: parentCommentId }).delete();
      await tenantTable(context.tenant, 'comments').where({ tenant: parentContext.tenant, comment_id: parentCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: parentContext.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T017: rejects replies to a soft-deleted parent comment', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const parentCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Soft-deleted parent comment',
      markdown_content: 'Soft-deleted parent comment',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;

    try {
      const parent = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: parentCommentId })
        .first();
      threadId = parent.thread_id;

      await tenantTable(context.tenant, 'comments')
        .where({ tenant: context.tenant, comment_id: parentCommentId })
        .update({ deleted_at: new Date().toISOString() });

      await expect(Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Invalid reply to deleted parent',
        markdown_content: 'Invalid reply to deleted parent',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: parentCommentId,
      })).rejects.toThrow('Cannot reply to a deleted comment');
    } finally {
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, parent_comment_id: parentCommentId }).delete();
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: parentCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T018: rejects reply visibility that differs from the thread root', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const clientRootId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Client-visible root for visibility test',
      markdown_content: 'Client-visible root for visibility test',
      is_internal: false,
      is_resolution: false,
    });
    const internalRootId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Internal root for visibility test',
      markdown_content: 'Internal root for visibility test',
      is_internal: true,
      is_resolution: false,
    });

    const roots = await tenantTable(context.tenant, 'comments')
      .select('comment_id', 'thread_id')
      .where({ tenant: context.tenant })
      .whereIn('comment_id', [clientRootId, internalRootId]);
    const threadIds = roots.map((root) => root.thread_id);

    try {
      await expect(Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Invalid internal reply on client thread',
        markdown_content: 'Invalid internal reply on client thread',
        is_internal: true,
        is_resolution: false,
        parent_comment_id: clientRootId,
      })).rejects.toThrow('Reply visibility must match the thread root visibility');

      await expect(Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Invalid client-visible reply on internal thread',
        markdown_content: 'Invalid client-visible reply on internal thread',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: internalRootId,
      })).rejects.toThrow('Reply visibility must match the thread root visibility');
    } finally {
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant }).whereIn('parent_comment_id', [clientRootId, internalRootId]).delete();
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant }).whereIn('comment_id', [clientRootId, internalRootId]).delete();
      if (threadIds.length > 0) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant }).whereIn('thread_id', threadIds).delete();
      }
    }
  });

  it('T019: inserting a reply increments reply_count and bumps last_activity_at', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for reply counter test',
      markdown_content: 'Root comment for reply counter test',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const beforeQuery = tenantTable(context.tenant, 'comments as c');
      scopedDb(context.tenant).tenantJoin(beforeQuery, 'comment_threads as ct', 'c.thread_id', 'ct.thread_id');
      const before = await beforeQuery
        .select('ct.thread_id', 'ct.reply_count', 'ct.last_activity_at')
        .where('c.tenant', context.tenant)
        .where('c.comment_id', rootCommentId)
        .first();
      threadId = before.thread_id;

      replyCommentId = await Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Reply comment for counter test',
        markdown_content: 'Reply comment for counter test',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      const after = await tenantTable(context.tenant, 'comment_threads')
        .select('reply_count', 'last_activity_at')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();
      expect(after.reply_count).toBe(Number(before.reply_count) + 1);
      expect(new Date(after.last_activity_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.last_activity_at).getTime()
      );
    } finally {
      if (replyCommentId) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T077: concurrent replies on the same thread both increment reply_count', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for concurrent reply counter test',
      markdown_content: 'Root comment for concurrent reply counter test',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentIds: string[] = [];

    try {
      const root = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentIds = await Promise.all([
        Comment.insert(knex, context.tenant, {
          ticket_id: context.ticket_id,
          user_id: context.user_id,
          author_type: 'internal',
          note: 'Concurrent reply A',
          markdown_content: 'Concurrent reply A',
          is_internal: false,
          is_resolution: false,
          parent_comment_id: rootCommentId,
        }),
        Comment.insert(knex, context.tenant, {
          ticket_id: context.ticket_id,
          user_id: context.user_id,
          author_type: 'internal',
          note: 'Concurrent reply B',
          markdown_content: 'Concurrent reply B',
          is_internal: false,
          is_resolution: false,
          parent_comment_id: rootCommentId,
        }),
      ]);

      const thread = await tenantTable(context.tenant, 'comment_threads')
        .select('reply_count')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();
      expect(thread.reply_count).toBe(2);

      const replies = await tenantTable(context.tenant, 'comments')
        .select('comment_id', 'thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, parent_comment_id: rootCommentId })
        .whereIn('comment_id', replyCommentIds);
      expect(replies).toHaveLength(2);
      for (const reply of replies) {
        expect(reply).toMatchObject({
          thread_id: threadId,
          parent_comment_id: rootCommentId,
        });
      }
    } finally {
      if (replyCommentIds.length > 0) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant }).whereIn('comment_id', replyCommentIds).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T020: deleting a leaf reply hard-deletes it and decrements reply_count', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for leaf delete test',
      markdown_content: 'Root comment for leaf delete test',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentId = await Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Leaf reply for delete test',
        markdown_content: 'Leaf reply for delete test',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      const beforeDelete = await tenantTable(context.tenant, 'comment_threads')
        .select('reply_count')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();
      expect(beforeDelete.reply_count).toBe(1);

      await Comment.delete(knex, context.tenant, replyCommentId);

      const deletedReply = await tenantTable(context.tenant, 'comments')
        .select('comment_id')
        .where({ tenant: context.tenant, comment_id: replyCommentId })
        .first();
      expect(deletedReply).toBeUndefined();

      const afterDelete = await tenantTable(context.tenant, 'comment_threads')
        .select('reply_count')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();
      expect(afterDelete.reply_count).toBe(0);
    } finally {
      if (replyCommentId) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T021: deleting a root with children soft-deletes it and leaves children intact', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for soft-delete test',
      markdown_content: 'Root comment for soft-delete test',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentId = await Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Child reply that must survive root soft-delete',
        markdown_content: 'Child reply that must survive root soft-delete',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      await Comment.delete(knex, context.tenant, rootCommentId);

      const deletedRoot = await tenantTable(context.tenant, 'comments')
        .select('comment_id', 'note', 'markdown_content', 'deleted_at')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      expect(deletedRoot).toMatchObject({
        comment_id: rootCommentId,
        note: '[deleted]',
        markdown_content: '[deleted]',
      });
      expect(deletedRoot.deleted_at).toBeTruthy();

      const child = await tenantTable(context.tenant, 'comments')
        .select('comment_id', 'parent_comment_id')
        .where({ tenant: context.tenant, comment_id: replyCommentId })
        .first();
      expect(child).toMatchObject({
        comment_id: replyCommentId,
        parent_comment_id: rootCommentId,
      });
    } finally {
      if (replyCommentId) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });

  it('T022: getAllbyTicketId returns threading fields including soft-deleted roots', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const rootCommentId = await Comment.insert(knex, context.tenant, {
      ticket_id: context.ticket_id,
      user_id: context.user_id,
      author_type: 'internal',
      note: 'Root comment for read contract test',
      markdown_content: 'Root comment for read contract test',
      is_internal: false,
      is_resolution: false,
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentId = await Comment.insert(knex, context.tenant, {
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        author_type: 'internal',
        note: 'Reply comment for read contract test',
        markdown_content: 'Reply comment for read contract test',
        is_internal: false,
        is_resolution: false,
        parent_comment_id: rootCommentId,
      });

      await Comment.delete(knex, context.tenant, rootCommentId);

      const comments = await Comment.getAllbyTicketId(knex, context.tenant, context.ticket_id);
      const readRoot = comments.find((comment) => comment.comment_id === rootCommentId);
      const readReply = comments.find((comment) => comment.comment_id === replyCommentId);

      expect(readRoot).toMatchObject({
        comment_id: rootCommentId,
        thread_id: threadId,
        parent_comment_id: null,
        note: '[deleted]',
      });
      expect(readRoot?.deleted_at).toBeTruthy();
      expect(readReply).toMatchObject({
        comment_id: replyCommentId,
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });
      expect(readReply?.deleted_at ?? null).toBeNull();
    } finally {
      if (replyCommentId) {
        await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: replyCommentId }).delete();
      }
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: rootCommentId }).delete();
      if (threadId) {
        await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: threadId }).delete();
      }
    }
  });
});

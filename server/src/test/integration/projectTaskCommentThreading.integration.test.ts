import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as { user_id: string; user_type: 'internal' | 'client' } | null,
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

import { createTaskComment, deleteTaskComment, getTaskComments } from '../../../../packages/projects/src/actions/projectTaskCommentActions';

const blockNote = (text: string) => JSON.stringify([
  {
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
  },
]);

describe('project task comment threading model', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .join('users as u', function() {
        this.on('u.tenant', 'pt.tenant').andOnVal('u.user_type', 'internal');
      })
      .select('pt.tenant', 'u.user_id')
      .first();
    expect(context).toBeTruthy();
    dbRef.knex = knex;
    dbRef.tenant = context.tenant;
    userRef.user = { user_id: context.user_id, user_type: 'internal' };
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T023: creates a new comment thread for a top-level project task comment', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const taskCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Top-level task comment created by threading test'),
    });

    try {
      const comment = await knex('project_task_comments')
        .select('task_comment_id', 'thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, task_comment_id: taskCommentId })
        .first();
      expect(comment?.thread_id).toBeTruthy();
      expect(comment?.parent_comment_id).toBeNull();

      const thread = await knex('comment_threads')
        .select('thread_id', 'ticket_id', 'project_task_id', 'root_comment_id', 'is_internal', 'reply_count')
        .where({ tenant: context.tenant, thread_id: comment.thread_id })
        .first();
      expect(thread).toMatchObject({
        thread_id: comment.thread_id,
        ticket_id: null,
        project_task_id: context.task_id,
        root_comment_id: taskCommentId,
        is_internal: false,
        reply_count: 0,
      });
    } finally {
      const comment = await knex('project_task_comments')
        .select('thread_id')
        .where({ tenant: context.tenant, task_comment_id: taskCommentId })
        .first();
      await knex('project_task_comments')
        .where({ tenant: context.tenant, task_comment_id: taskCommentId })
        .delete();
      if (comment?.thread_id) {
        await knex('comment_threads')
          .where({ tenant: context.tenant, thread_id: comment.thread_id })
          .delete();
      }
    }
  });

  it('T024: task replies inherit thread_id and increment reply_count', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Root task comment for reply inheritance test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await knex('project_task_comments')
        .select('thread_id')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      const before = await knex('comment_threads')
        .select('reply_count', 'last_activity_at')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();

      replyCommentId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Reply task comment for thread inheritance test'),
        parent_comment_id: rootCommentId,
      });

      const reply = await knex('project_task_comments')
        .select('thread_id', 'parent_comment_id')
        .where({ tenant: context.tenant, task_comment_id: replyCommentId })
        .first();
      expect(reply).toMatchObject({
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });

      const after = await knex('comment_threads')
        .select('reply_count', 'last_activity_at')
        .where({ tenant: context.tenant, thread_id: threadId })
        .first();
      expect(after.reply_count).toBe(Number(before.reply_count) + 1);
      expect(new Date(after.last_activity_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.last_activity_at).getTime()
      );
    } finally {
      if (replyCommentId) {
        await knex('project_task_comments')
          .where({ tenant: context.tenant, task_comment_id: replyCommentId })
          .delete();
      }
      await knex('project_task_comments')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await knex('comment_threads')
          .where({ tenant: context.tenant, thread_id: threadId })
          .delete();
      }
    }
  });

  it('T025: deleteTaskComment hard-deletes leaf replies and soft-deletes roots with children', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const leafRootId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for leaf delete test'),
    });
    const softDeleteRootId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for soft-delete test'),
    });

    let leafThreadId: string | undefined;
    let leafReplyId: string | undefined;
    let softDeleteThreadId: string | undefined;
    let softDeleteReplyId: string | undefined;

    try {
      const roots = await knex('project_task_comments')
        .select('task_comment_id', 'thread_id')
        .where({ tenant: context.tenant })
        .whereIn('task_comment_id', [leafRootId, softDeleteRootId]);
      leafThreadId = roots.find((root) => root.task_comment_id === leafRootId)?.thread_id;
      softDeleteThreadId = roots.find((root) => root.task_comment_id === softDeleteRootId)?.thread_id;

      leafReplyId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Task leaf reply to hard-delete'),
        parent_comment_id: leafRootId,
      });
      softDeleteReplyId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Task child that survives root soft-delete'),
        parent_comment_id: softDeleteRootId,
      });

      await deleteTaskComment(leafReplyId);

      const deletedLeaf = await knex('project_task_comments')
        .select('task_comment_id')
        .where({ tenant: context.tenant, task_comment_id: leafReplyId })
        .first();
      expect(deletedLeaf).toBeUndefined();

      const leafThread = await knex('comment_threads')
        .select('reply_count')
        .where({ tenant: context.tenant, thread_id: leafThreadId })
        .first();
      expect(leafThread.reply_count).toBe(0);

      await deleteTaskComment(softDeleteRootId);

      const deletedRoot = await knex('project_task_comments')
        .select('task_comment_id', 'note', 'markdown_content', 'deleted_at')
        .where({ tenant: context.tenant, task_comment_id: softDeleteRootId })
        .first();
      expect(deletedRoot).toMatchObject({
        task_comment_id: softDeleteRootId,
        note: '[deleted]',
        markdown_content: '[deleted]',
      });
      expect(deletedRoot.deleted_at).toBeTruthy();

      const child = await knex('project_task_comments')
        .select('task_comment_id', 'parent_comment_id')
        .where({ tenant: context.tenant, task_comment_id: softDeleteReplyId })
        .first();
      expect(child).toMatchObject({
        task_comment_id: softDeleteReplyId,
        parent_comment_id: softDeleteRootId,
      });
    } finally {
      await knex('project_task_comments')
        .where({ tenant: context.tenant })
        .whereIn('task_comment_id', [leafReplyId, softDeleteReplyId].filter(Boolean))
        .delete();
      await knex('project_task_comments')
        .where({ tenant: context.tenant })
        .whereIn('task_comment_id', [leafRootId, softDeleteRootId])
        .delete();
      await knex('comment_threads')
        .where({ tenant: context.tenant })
        .whereIn('thread_id', [leafThreadId, softDeleteThreadId].filter(Boolean))
        .delete();
    }
  });

  it('T026: getTaskComments returns threading fields including soft-deleted roots', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for read contract test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await knex('project_task_comments')
        .select('thread_id')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      replyCommentId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Task reply for read contract test'),
        parent_comment_id: rootCommentId,
      });

      await deleteTaskComment(rootCommentId);

      const comments = await getTaskComments(context.task_id);
      const readRoot = comments.find((comment) => comment.taskCommentId === rootCommentId);
      const readReply = comments.find((comment) => comment.taskCommentId === replyCommentId);

      expect(readRoot).toMatchObject({
        taskCommentId: rootCommentId,
        threadId,
        parentCommentId: null,
        note: '[deleted]',
      });
      expect(readRoot?.deletedAt).toBeTruthy();
      expect(readReply).toMatchObject({
        taskCommentId: replyCommentId,
        threadId,
        parentCommentId: rootCommentId,
      });
      expect(readReply?.deletedAt ?? null).toBeNull();
    } finally {
      if (replyCommentId) {
        await knex('project_task_comments')
          .where({ tenant: context.tenant, task_comment_id: replyCommentId })
          .delete();
      }
      await knex('project_task_comments')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await knex('comment_threads')
          .where({ tenant: context.tenant, thread_id: threadId })
          .delete();
      }
    }
  });

  it('T031: TASK_COMMENT_ADDED payload includes reply threading fields', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for event payload test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await knex('project_task_comments')
        .select('thread_id')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      publishEventMock.mockClear();
      replyCommentId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Task reply for event payload test'),
        parent_comment_id: rootCommentId,
      });

      const addedEvent = publishEventMock.mock.calls
        .map(([event]) => event)
        .find((event) => event.eventType === 'TASK_COMMENT_ADDED');
      expect(addedEvent).toBeTruthy();
      expect(addedEvent.payload).toMatchObject({
        tenantId: context.tenant,
        taskId: context.task_id,
        userId: userRef.user?.user_id,
        taskCommentId: replyCommentId,
        threadId,
        parentCommentId: rootCommentId,
        isReply: true,
        thread_id: threadId,
        parent_comment_id: rootCommentId,
        is_reply: true,
      });
    } finally {
      if (replyCommentId) {
        await knex('project_task_comments')
          .where({ tenant: context.tenant, task_comment_id: replyCommentId })
          .delete();
      }
      await knex('project_task_comments')
        .where({ tenant: context.tenant, task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await knex('comment_threads')
          .where({ tenant: context.tenant, thread_id: threadId })
          .delete();
      }
    }
  });

  it('T032: client users can delete own task replies but not another client reply', async () => {
    const context = await knex('project_tasks as pt')
      .join('project_phases as pp', function() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .select('pt.tenant', 'pt.task_id')
      .where('pt.tenant', dbRef.tenant)
      .first();
    expect(context).toBeTruthy();

    const ids = await knex.raw(`
      SELECT
        gen_random_uuid() AS thread_id,
        gen_random_uuid() AS root_comment_id,
        gen_random_uuid() AS own_reply_id,
        gen_random_uuid() AS other_reply_id,
        gen_random_uuid() AS client_user_id,
        gen_random_uuid() AS other_client_user_id
    `);
    const generated = ids.rows[0];
    const now = new Date().toISOString();
    const originalUser = userRef.user;

    try {
      await knex('users').insert([
        {
          tenant: context.tenant,
          user_id: generated.client_user_id,
          username: `task-client-own-${Date.now()}`,
          hashed_password: 'not-used',
          first_name: 'Task',
          last_name: 'Client Own',
          email: `task-client-own-${Date.now()}@example.test`,
          user_type: 'client',
        },
        {
          tenant: context.tenant,
          user_id: generated.other_client_user_id,
          username: `task-client-other-${Date.now()}`,
          hashed_password: 'not-used',
          first_name: 'Task',
          last_name: 'Client Other',
          email: `task-client-other-${Date.now()}@example.test`,
          user_type: 'client',
        },
      ]);

      await knex('comment_threads').insert({
        tenant: context.tenant,
        thread_id: generated.thread_id,
        ticket_id: null,
        project_task_id: context.task_id,
        root_comment_id: generated.root_comment_id,
        is_internal: false,
        reply_count: 2,
        last_activity_at: now,
        created_at: now,
        created_by: originalUser?.user_id,
      });

      await knex('project_task_comments').insert([
        {
          tenant: context.tenant,
          task_comment_id: generated.root_comment_id,
          task_id: context.task_id,
          thread_id: generated.thread_id,
          parent_comment_id: null,
          user_id: originalUser?.user_id,
          author_type: 'internal',
          note: blockNote('Task root for ownership delete test'),
          markdown_content: 'Task root for ownership delete test',
          created_at: now,
        },
        {
          tenant: context.tenant,
          task_comment_id: generated.own_reply_id,
          task_id: context.task_id,
          thread_id: generated.thread_id,
          parent_comment_id: generated.root_comment_id,
          user_id: generated.client_user_id,
          author_type: 'internal',
          note: blockNote('Own task reply for ownership delete test'),
          markdown_content: 'Own task reply for ownership delete test',
          created_at: now,
        },
        {
          tenant: context.tenant,
          task_comment_id: generated.other_reply_id,
          task_id: context.task_id,
          thread_id: generated.thread_id,
          parent_comment_id: generated.root_comment_id,
          user_id: generated.other_client_user_id,
          author_type: 'internal',
          note: blockNote('Other task reply for ownership delete test'),
          markdown_content: 'Other task reply for ownership delete test',
          created_at: now,
        },
      ]);

      userRef.user = { user_id: generated.client_user_id, user_type: 'client' };
      await deleteTaskComment(generated.own_reply_id);

      const ownReply = await knex('project_task_comments')
        .select('task_comment_id')
        .where({ tenant: context.tenant, task_comment_id: generated.own_reply_id })
        .first();
      expect(ownReply).toBeUndefined();

      await expect(deleteTaskComment(generated.other_reply_id))
        .rejects.toThrow('You can only delete your own comments');

      const otherReply = await knex('project_task_comments')
        .select('task_comment_id')
        .where({ tenant: context.tenant, task_comment_id: generated.other_reply_id })
        .first();
      expect(otherReply).toBeTruthy();
    } finally {
      userRef.user = originalUser;
      await knex('project_task_comments')
        .where({ tenant: context.tenant })
        .whereIn('task_comment_id', [generated.own_reply_id, generated.other_reply_id, generated.root_comment_id])
        .delete();
      await knex('comment_threads')
        .where({ tenant: context.tenant, thread_id: generated.thread_id })
        .delete();
      await knex('users')
        .where({ tenant: context.tenant })
        .whereIn('user_id', [generated.client_user_id, generated.other_client_user_id])
        .delete();
    }
  });
});

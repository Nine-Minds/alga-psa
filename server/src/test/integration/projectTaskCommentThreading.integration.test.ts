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

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

import { createTaskComment } from '../../../../packages/projects/src/actions/projectTaskCommentActions';

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
});

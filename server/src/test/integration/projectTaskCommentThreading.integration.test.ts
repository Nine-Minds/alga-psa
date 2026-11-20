import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { tenantDb } from '@alga-psa/db';
import { registerCoManagedTaskDisclosureCases } from './helpers/coManagedTaskDisclosureCases';
import { registerCoManagedRequesterTaskCases } from './helpers/coManagedRequesterTaskCases';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as { user_id: string; user_type: 'internal' | 'client'; clientId?: string } | null,
}));
const permissionRef = vi.hoisted(() => ({ deniedProjectTaskReaders: new Set<string>() }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  checkMultiplePermissions: vi.fn(async (_user: unknown, checks: Array<{ resource: string; action: string }>) =>
    checks.map(check => ({ ...check, granted: true }))),
}));

// getTaskComments now gates on project_task:read through the rbac entry point.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/authorization/rbac', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/rbac')>();
  return {
    ...actual,
    hasPermission: vi.fn(async (user: { user_id: string }, resource: string) =>
      resource !== 'project_task' || !permissionRef.deniedProjectTaskReaders.has(user.user_id)),
  };
});

const publishEventMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { createTaskComment, deleteTaskComment, getTaskComments } from '../../../../packages/projects/src/actions/projectTaskCommentActions';
import { discardProjectTaskCommentAttachmentDrafts } from '../../../../packages/projects/src/actions/projectTaskCommentAttachmentDraftActions';
import { getAuthorizedDocumentByFileId } from '@alga-psa/documents/actions/documentActions';

const blockNote = (text: string) => JSON.stringify([
  {
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
  },
]);

describe('project task comment threading model', () => {
  let knex: Knex;

  function scopedDb(tenant = dbRef.tenant) {
    return tenantDb(knex, tenant);
  }

  function taskContextQuery(tenant = dbRef.tenant) {
    const db = scopedDb(tenant);
    const query = db.table('project_tasks as pt');
    db.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
    return query;
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const contextQuery = discoveryDb.unscoped(
      'project_tasks as pt',
      'test discovery of seeded project task/user context for comment threading'
    );
    discoveryDb.tenantJoin(contextQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
    discoveryDb.tenantJoin(contextQuery, 'users as u', 'u.tenant', 'pt.tenant', {
      on: (join) => join.andOnVal('u.user_type', 'internal'),
    });
    const context = await contextQuery.select('pt.tenant', 'u.user_id').first();
    expect(context).toBeTruthy();
    dbRef.knex = knex;
    dbRef.tenant = context.tenant;
    userRef.user = await scopedDb().table('users').where({ user_id: context.user_id }).first();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T023: creates a new comment thread for a top-level project task comment', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id')
      .first();
    expect(context).toBeTruthy();

    const taskCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Top-level task comment created by threading test'),
    });

    try {
      const comment = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id', 'thread_id', 'parent_comment_id')
        .where({ task_comment_id: taskCommentId })
        .first();
      expect(comment?.thread_id).toBeTruthy();
      expect(comment?.parent_comment_id).toBeNull();

      const thread = await scopedDb(context.tenant).table('comment_threads')
        .select('thread_id', 'ticket_id', 'project_task_id', 'root_comment_id', 'is_internal', 'reply_count')
        .where({ thread_id: comment.thread_id })
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
      const comment = await scopedDb(context.tenant).table('project_task_comments')
        .select('thread_id')
        .where({ task_comment_id: taskCommentId })
        .first();
      await scopedDb(context.tenant).table('project_task_comments')
        .where({ task_comment_id: taskCommentId })
        .delete();
      if (comment?.thread_id) {
        await scopedDb(context.tenant).table('comment_threads')
          .where({ thread_id: comment.thread_id })
          .delete();
      }
    }
  });

  it('T024: task replies inherit thread_id and increment reply_count', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Root task comment for reply inheritance test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('project_task_comments')
        .select('thread_id')
        .where({ task_comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      const before = await scopedDb(context.tenant).table('comment_threads')
        .select('reply_count', 'last_activity_at')
        .where({ thread_id: threadId })
        .first();

      replyCommentId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Reply task comment for thread inheritance test'),
        parent_comment_id: rootCommentId,
      });

      const reply = await scopedDb(context.tenant).table('project_task_comments')
        .select('thread_id', 'parent_comment_id')
        .where({ task_comment_id: replyCommentId })
        .first();
      expect(reply).toMatchObject({
        thread_id: threadId,
        parent_comment_id: rootCommentId,
      });

      const after = await scopedDb(context.tenant).table('comment_threads')
        .select('reply_count', 'last_activity_at')
        .where({ thread_id: threadId })
        .first();
      expect(after.reply_count).toBe(Number(before.reply_count) + 1);
      expect(new Date(after.last_activity_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.last_activity_at).getTime()
      );
    } finally {
      if (replyCommentId) {
        await scopedDb(context.tenant).table('project_task_comments')
          .where({ task_comment_id: replyCommentId })
          .delete();
      }
      await scopedDb(context.tenant).table('project_task_comments')
        .where({ task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads')
          .where({ thread_id: threadId })
          .delete();
      }
    }
  });

  it('T025: deleteTaskComment hard-deletes leaf replies and soft-deletes roots with children', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id')
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
      const roots = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id', 'thread_id')
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

      const deletedLeaf = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id')
        .where({ task_comment_id: leafReplyId })
        .first();
      expect(deletedLeaf).toBeUndefined();

      const leafThread = await scopedDb(context.tenant).table('comment_threads')
        .select('reply_count')
        .where({ thread_id: leafThreadId })
        .first();
      expect(leafThread.reply_count).toBe(0);

      await deleteTaskComment(softDeleteRootId);

      const deletedRoot = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id', 'note', 'markdown_content', 'deleted_at')
        .where({ task_comment_id: softDeleteRootId })
        .first();
      expect(deletedRoot).toMatchObject({
        task_comment_id: softDeleteRootId,
        note: '[deleted]',
        markdown_content: '[deleted]',
      });
      expect(deletedRoot.deleted_at).toBeTruthy();

      const child = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id', 'parent_comment_id')
        .where({ task_comment_id: softDeleteReplyId })
        .first();
      expect(child).toMatchObject({
        task_comment_id: softDeleteReplyId,
        parent_comment_id: softDeleteRootId,
      });
    } finally {
      await scopedDb(context.tenant).table('project_task_comments')
        .whereIn('task_comment_id', [leafReplyId, softDeleteReplyId].filter(Boolean))
        .delete();
      await scopedDb(context.tenant).table('project_task_comments')
        .whereIn('task_comment_id', [leafRootId, softDeleteRootId])
        .delete();
      await scopedDb(context.tenant).table('comment_threads')
        .whereIn('thread_id', [leafThreadId, softDeleteThreadId].filter(Boolean))
        .delete();
    }
  });

  it('T026: getTaskComments returns threading fields including soft-deleted roots', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for read contract test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('project_task_comments')
        .select('thread_id')
        .where({ task_comment_id: rootCommentId })
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
        await scopedDb(context.tenant).table('project_task_comments')
          .where({ task_comment_id: replyCommentId })
          .delete();
      }
      await scopedDb(context.tenant).table('project_task_comments')
        .where({ task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads')
          .where({ thread_id: threadId })
          .delete();
      }
    }
  });

  it('T031: TASK_COMMENT_ADDED payload includes reply threading fields', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id')
      .first();
    expect(context).toBeTruthy();

    const rootCommentId = await createTaskComment({
      taskId: context.task_id,
      note: blockNote('Task root for event payload test'),
    });

    let threadId: string | undefined;
    let replyCommentId: string | undefined;

    try {
      const root = await scopedDb(context.tenant).table('project_task_comments')
        .select('thread_id')
        .where({ task_comment_id: rootCommentId })
        .first();
      threadId = root.thread_id;

      publishEventMock.mockClear();
      publishWorkflowEventMock.mockClear();
      replyCommentId = await createTaskComment({
        taskId: context.task_id,
        note: blockNote('Task reply for event payload test'),
        parent_comment_id: rootCommentId,
      });

      // TASK_COMMENT_ADDED is now a catalogued event published through publishWorkflowEvent; the tenant
      // travels in ctx and is stamped into the payload by the publisher.
      const addedEvent = publishWorkflowEventMock.mock.calls
        .map(([event]) => event)
        .find((event) => event.eventType === 'TASK_COMMENT_ADDED');
      expect(addedEvent).toBeTruthy();
      expect(addedEvent.ctx.tenantId).toBe(context.tenant);
      expect(addedEvent.payload).toMatchObject({
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
        await scopedDb(context.tenant).table('project_task_comments')
          .where({ task_comment_id: replyCommentId })
          .delete();
      }
      await scopedDb(context.tenant).table('project_task_comments')
        .where({ task_comment_id: rootCommentId })
        .delete();
      if (threadId) {
        await scopedDb(context.tenant).table('comment_threads')
          .where({ thread_id: threadId })
          .delete();
      }
    }
  });

  it('T032: client users can delete own task replies but not another client reply', async () => {
    const context = await taskContextQuery()
      .select('pt.tenant', 'pt.task_id', 'pp.project_id')
      .first();
    expect(context).toBeTruthy();
    // Client users act within their own client's projects (record-level same_client scope).
    const project = await scopedDb(context.tenant).table('projects')
      .select('client_id')
      .where({ project_id: context.project_id })
      .first();
    expect(project?.client_id).toBeTruthy();

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
      await scopedDb(context.tenant).table('users').insert([
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

      await scopedDb(context.tenant).table('comment_threads').insert({
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

      await scopedDb(context.tenant).table('project_task_comments').insert([
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

      userRef.user = { user_id: generated.client_user_id, user_type: 'client', clientId: project.client_id };
      await deleteTaskComment(generated.own_reply_id);

      const ownReply = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id')
        .where({ task_comment_id: generated.own_reply_id })
        .first();
      expect(ownReply).toBeUndefined();

      const deniedDeleteResult = await deleteTaskComment(generated.other_reply_id);
      expect(deniedDeleteResult).toMatchObject({
        actionError: 'You can only delete your own comments',
      });

      const otherReply = await scopedDb(context.tenant).table('project_task_comments')
        .select('task_comment_id')
        .where({ task_comment_id: generated.other_reply_id })
        .first();
      expect(otherReply).toBeTruthy();
    } finally {
      userRef.user = originalUser;
      await scopedDb(context.tenant).table('project_task_comments')
        .whereIn('task_comment_id', [generated.own_reply_id, generated.other_reply_id, generated.root_comment_id])
        .delete();
      await scopedDb(context.tenant).table('comment_threads')
        .where({ thread_id: generated.thread_id })
        .delete();
      await scopedDb(context.tenant).table('users')
        .whereIn('user_id', [generated.client_user_id, generated.other_client_user_id])
        .delete();
    }
  });

  it('saves an image-only task comment and enforces task and audience access on image retrieval', async () => {
    const originalUser = userRef.user;
    const db = scopedDb();
    const taskQuery = db.table('project_tasks as pt');
    db.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
    db.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id');
    const task = await taskQuery.whereNotNull('p.client_id')
      .select('pt.task_id', 'p.project_id', 'p.client_id', 'p.assigned_to').first();
    expect(task).toBeTruthy();

    const otherClientId = randomUUID();
    const allowedUserId = randomUUID(), deniedUserId = randomUUID();
    const allowedContactId = randomUUID(), deniedContactId = randomUUID();
    const fileId = randomUUID();
    const documentId = randomUUID();
    let commentId: string | undefined;
    let threadId: string | undefined;
    const note = JSON.stringify([{
      type: 'image',
      props: { url: `/api/documents/view/${fileId}`, name: 'pasted.png' },
      children: [],
    }]);
    permissionRef.deniedProjectTaskReaders.clear();
    userRef.user = originalUser;

    try {
      await db.table('clients').insert({ tenant: dbRef.tenant, client_id: otherClientId, client_name: 'Image retrieval scope test' });
      await db.table('contacts').insert([
        { tenant: dbRef.tenant, contact_name_id: allowedContactId, client_id: task.client_id, full_name: 'Allowed image reader', email: `${allowedUserId}@example.test` },
        { tenant: dbRef.tenant, contact_name_id: deniedContactId, client_id: otherClientId, full_name: 'Out of scope image reader', email: `${deniedUserId}@example.test` },
      ]);
      await db.table('users').insert([
        { tenant: dbRef.tenant, user_id: allowedUserId, contact_id: allowedContactId, user_type: 'client', username: allowedUserId, email: `${allowedUserId}@example.test`, hashed_password: 'unused', is_inactive: false },
        { tenant: dbRef.tenant, user_id: deniedUserId, contact_id: deniedContactId, user_type: 'client', username: deniedUserId, email: `${deniedUserId}@example.test`, hashed_password: 'unused', is_inactive: false },
      ]);
      await db.table('external_files').insert({
        tenant: dbRef.tenant, file_id: fileId, file_name: 'pasted.png', original_name: 'pasted.png',
        mime_type: 'image/png', file_size: 7, storage_path: `test/${fileId}`, uploaded_by_id: originalUser!.user_id,
      });
      await db.table('documents').insert({
        tenant: dbRef.tenant, document_id: documentId, document_name: 'pasted.png', file_id: fileId,
        mime_type: 'image/png', file_size: 7, user_id: originalUser!.user_id,
        created_by: originalUser!.user_id, is_client_visible: true,
      });
      await db.table('document_associations').insert({
        tenant: dbRef.tenant, document_id: documentId, entity_type: 'project_task', entity_id: task.task_id,
      });
      await db.table('comment_attachment_drafts').insert({
        tenant: dbRef.tenant, entity_type: 'project_task', entity_id: task.task_id,
        document_id: documentId, file_id: fileId, created_by: originalUser!.user_id, state: 'draft',
        expires_at: new Date(Date.now() + 86_400_000),
      });

      commentId = await createTaskComment({ taskId: task.task_id, note, audience: 'requester' });
      const saved = await db.table('project_task_comments').where({ task_comment_id: commentId })
        .select('thread_id', 'note').first();
      threadId = saved.thread_id;
      expect(saved.note).toContain(`/api/documents/view/${fileId}`);
      expect(await db.table('comment_attachment_drafts').where({ document_id: documentId })
        .first('state', 'comment_id')).toMatchObject({ state: 'attached', comment_id: commentId });

      const reloaded = await getTaskComments(task.task_id);
      expect(reloaded.find(comment => comment.taskCommentId === commentId)?.note).toContain(`/api/documents/view/${fileId}`);

      const requester = (userId: string, clientId: string) => ({
        user_id: userId, user_type: 'client' as const, tenant: dbRef.tenant,
        clientId, is_inactive: false, username: userId, email: `${userId}@example.test`,
      });
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant,
        requester(allowedUserId, task.client_id), fileId))
        .toMatchObject({ document_id: documentId });

      permissionRef.deniedProjectTaskReaders.add(allowedUserId);
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant,
        requester(allowedUserId, task.client_id), fileId)).toBeNull();
      permissionRef.deniedProjectTaskReaders.delete(allowedUserId);

      // This document reader has the coarse task grant but is outside the parent project's client scope.
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant,
        requester(deniedUserId, otherClientId), fileId)).toBeNull();

      // The same record-authorized reader is denied when the owning thread excludes requesters.
      await db.table('comment_threads').where({ thread_id: threadId })
        .update({ collaboration_audience: 'organization_private', is_internal: true });
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant,
        requester(allowedUserId, task.client_id), fileId)).toBeNull();
    } finally {
      userRef.user = originalUser;
      permissionRef.deniedProjectTaskReaders.clear();
      if (commentId) await db.table('project_task_comments').where({ task_comment_id: commentId }).delete();
      if (threadId) await db.table('comment_threads').where({ thread_id: threadId }).delete();
      await db.table('comment_attachment_drafts').where({ document_id: documentId }).delete();
      await db.table('document_associations').where({ document_id: documentId }).delete();
      await db.table('documents').where({ document_id: documentId }).delete();
      await db.table('external_files').where({ file_id: fileId }).delete();
      await db.table('users').whereIn('user_id', [allowedUserId, deniedUserId]).delete();
      await db.table('contacts').whereIn('contact_name_id', [allowedContactId, deniedContactId]).delete();
      await db.table('clients').where({ client_id: otherClientId }).delete();
    }
  });

  it('serializes task comment draft promotion and discard in the database', async () => {
    const db = scopedDb();
    const context = await taskContextQuery().select('pt.task_id').first();
    expect(context).toBeTruthy();
    const actorId = userRef.user!.user_id;
    const fixtures: Array<{ documentId: string; fileId: string; commentId?: string; threadId?: string }> = [];
    const makeDraft = async () => {
      const documentId = randomUUID(), fileId = randomUUID();
      fixtures.push({ documentId, fileId });
      await db.table('external_files').insert({ tenant: dbRef.tenant, file_id: fileId, file_name: 'race.png', original_name: 'race.png', mime_type: 'image/png', file_size: 5, storage_path: `test/${fileId}`, uploaded_by_id: actorId });
      await db.table('documents').insert({ tenant: dbRef.tenant, document_id: documentId, document_name: 'race.png', file_id: fileId, mime_type: 'image/png', file_size: 5, user_id: actorId, created_by: actorId, is_client_visible: true });
      await db.table('document_associations').insert({ tenant: dbRef.tenant, document_id: documentId, entity_type: 'project_task', entity_id: context.task_id });
      await db.table('comment_attachment_drafts').insert({ tenant: dbRef.tenant, entity_type: 'project_task', entity_id: context.task_id, document_id: documentId, file_id: fileId, created_by: actorId, state: 'draft', expires_at: new Date(Date.now() + 86_400_000) });
      return { documentId, fileId };
    };

    const save = (fileId: string) => createTaskComment({
      taskId: context.task_id,
      note: JSON.stringify([{ type: 'image', props: { url: `/api/documents/view/${fileId}` }, children: [] }]),
    });
    const discard = (documentId: string) =>
      discardProjectTaskCommentAttachmentDrafts({ projectTaskId: context.task_id, documentIds: [documentId] });

    // Keep the winner's transaction open until Postgres sees the rival waiting on it.
    async function contend<T, R>(first: () => Promise<T>, second: () => Promise<R>) {
      let rival!: Promise<R>;
      const winner = await knex.transaction(async trx => {
        const { rows: [{ pid }] } = await trx.raw('SELECT pg_backend_pid() AS pid');
        let result: T;
        dbRef.knex = trx;
        try {
          result = await first();
        } finally {
          dbRef.knex = knex;
        }
        rival = second();
        await vi.waitFor(async () => {
          const { rows: [{ waiting }] } = await trx.raw(
            'SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))) AS waiting',
            [pid],
          );
          expect(waiting).toBe(true);
        }, { timeout: 5000 });
        return result;
      });
      return [winner, await rival] as const;
    }

    try {
      const saveWinner = await makeDraft();
      const [savedCommentId, retained] = await contend(
        () => save(saveWinner.fileId),
        () => discard(saveWinner.documentId),
      );
      if (typeof savedCommentId !== 'string') throw new Error('Expected a saved comment');
      fixtures.find(row => row.documentId === saveWinner.documentId)!.commentId = savedCommentId;
      expect(retained).toEqual({ deletedDocumentIds: [], failures: [] });
      expect(await db.table('comment_attachment_drafts').where({ document_id: saveWinner.documentId }).first('state', 'comment_id'))
        .toMatchObject({ state: 'attached', comment_id: savedCommentId });

      const discardWinner = await makeDraft();
      const withdrawn = { deletedDocumentIds: [discardWinner.documentId], failures: [] };
      const [discarded] = await contend(
        () => discard(discardWinner.documentId),
        () => expect(save(discardWinner.fileId)).rejects.toThrow(/expired, discarded/),
      );
      expect(discarded).toEqual(withdrawn);
      expect(await discard(discardWinner.documentId)).toEqual(withdrawn);
      const reader = await db.table('users').where({ user_id: actorId }).first();
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant, reader, discardWinner.fileId)).toBeNull();

      // Reclaim storage through the same worker that handles an abandoned upload.
      const { cleanupCommentAttachmentDrafts } = await import('@/lib/jobs/handlers/cleanupCommentAttachmentDrafts');
      const removeFile = vi.fn().mockResolvedValue(undefined);
      await cleanupCommentAttachmentDrafts(knex, dbRef.tenant, removeFile);
      expect(removeFile).toHaveBeenCalledWith(discardWinner.fileId, actorId, expect.anything());
      expect(await db.table('documents').where({ document_id: discardWinner.documentId }).first()).toBeUndefined();
      expect(await getAuthorizedDocumentByFileId(knex, dbRef.tenant, reader, saveWinner.fileId))
        .toMatchObject({ document_id: saveWinner.documentId });
      await expect(createTaskComment({
        taskId: context.task_id,
        note: JSON.stringify([{ type: 'image', props: { url: `/api/documents/view/${discardWinner.fileId}` }, children: [] }]),
      })).rejects.toThrow(/expired, discarded/);
      expect(await db.table('comment_attachment_drafts').where({ document_id: discardWinner.documentId }).first('state', 'comment_id'))
        .toMatchObject({ state: 'removed', comment_id: null });

      const expired = await makeDraft();
      await db.table('comment_attachment_drafts').where({ document_id: expired.documentId }).update({ expires_at: new Date(0) });
      await expect(createTaskComment({
        taskId: context.task_id,
        note: JSON.stringify([{ type: 'image', props: { url: `/api/documents/view/${expired.fileId}` }, children: [] }]),
      })).rejects.toThrow(/expired, discarded/);
      expect(await db.table('project_task_comments').where('note', 'like', `%${expired.fileId}%`)).toHaveLength(0);
    } finally {
      for (const fixture of fixtures) {
        if (fixture.commentId) {
          const comment = await db.table('project_task_comments').where({ task_comment_id: fixture.commentId }).first('thread_id');
          await db.table('project_task_comments').where({ task_comment_id: fixture.commentId }).delete();
          if (comment?.thread_id) await db.table('comment_threads').where({ thread_id: comment.thread_id }).delete();
        }
        await db.table('comment_attachment_drafts').where({ document_id: fixture.documentId }).delete();
        await db.table('document_associations').where({ document_id: fixture.documentId }).delete();
        await db.table('documents').where({ document_id: fixture.documentId }).delete();
        await db.table('external_files').where({ file_id: fixture.fileId }).delete();
      }
    }
  });
});

// L4c: the audience truth table for shared task conversations (owns its own DB lifecycle; keep it last).
registerCoManagedTaskDisclosureCases();
// L4c: the requester (portal contact) task thread; authors are contacts, never users.
registerCoManagedRequesterTaskCases();

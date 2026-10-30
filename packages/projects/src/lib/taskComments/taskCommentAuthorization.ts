/**
 * The one authorization boundary for project task comments. Every comment
 * operation, from the web server actions and the REST controller alike, runs
 * inside `withTaskCommentAccess`:
 *
 *   1. coarse `project_task:*` permission (a record-level pass never rescues a caller without it),
 *   2. resolve the target to its parent project inside one transaction, tenant-scoped,
 *   3. the record-level project authorizer (read for read/react, update for writes),
 *   4. for update/delete of someone else's comment, project-task update authority too,
 *   5. only then the caller's work, on the same transaction.
 *
 * A missing task/comment and a project the caller may not access throw the same
 * error, so ids cannot be probed.
 */

import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import ProjectModel from '../../models/project';
import { createProjectReadAuthorizer } from '../projectReadAuthorization';

export type TaskCommentAction = 'read' | 'create' | 'update' | 'delete' | 'react';

export type TaskCommentTarget = { taskId: string } | { taskCommentId: string };
/** Batch reads: unauthorized ids are dropped from the context rather than rejected. */
export type TaskCommentBatchTarget = { taskIds: string[] } | { taskCommentIds: string[] };

export type TaskCommentAccessRow = { taskId: string; projectId: string };
export type TaskCommentAccessContext = TaskCommentAccessRow & {
  trx: Knex.Transaction;
  comment?: { task_comment_id: string; task_id: string; user_id: string };
};
export type TaskCommentBatchAccessContext = {
  trx: Knex.Transaction;
  /** Authorized task ids (taskIds target) or comment ids (taskCommentIds target). */
  ids: string[];
};

const COARSE_PERMISSION: Record<TaskCommentAction, 'read' | 'create' | 'update' | 'delete'> = {
  read: 'read',
  react: 'read',
  create: 'create',
  update: 'update',
  delete: 'delete',
};

const NOT_FOUND = {
  task: 'Task not found',
  comment: 'Comment not found',
} as const;

type ResolvedTask = { task_id: string; project_id: string };
type CommentRow = { task_comment_id: string; task_id: string; user_id: string };

async function resolveTasks(trx: Knex.Transaction, tenant: string, taskIds: string[]): Promise<ResolvedTask[]> {
  if (taskIds.length === 0) return [];
  const query = tenantDb(trx, tenant).table('project_tasks');
  tenantDb(trx, tenant).tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  return await query
    .whereIn('project_tasks.task_id', taskIds)
    .select('project_tasks.task_id', 'project_phases.project_id') as ResolvedTask[];
}

async function resolveComments(trx: Knex.Transaction, tenant: string, commentIds: string[]): Promise<CommentRow[]> {
  if (commentIds.length === 0) return [];
  return await tenantDb(trx, tenant).table('project_task_comments')
    .whereIn('task_comment_id', commentIds)
    .select('task_comment_id', 'task_id', 'user_id') as CommentRow[];
}

async function assertCoarse(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  action: TaskCommentAction,
  permissionAction = COARSE_PERMISSION[action],
): Promise<void> {
  if (!(await hasPermission(user, 'project_task', permissionAction, trx))) {
    throw new Error(`Permission denied: Cannot ${permissionAction} project_task`);
  }
}

/** Per-project record decisions, memoised for the request. */
function projectDecider(trx: Knex.Transaction, tenant: string, user: IUserWithRoles, recordAction: 'read' | 'update') {
  const decisions = new Map<string, Promise<boolean>>();
  let authorizer: ReturnType<typeof createProjectReadAuthorizer> | null = null;
  return (projectId: string): Promise<boolean> => {
    let decision = decisions.get(projectId);
    if (!decision) {
      decision = (async () => {
        const project = await ProjectModel.getById(trx, tenant, projectId);
        if (!project) return false;
        authorizer ??= createProjectReadAuthorizer(trx, tenant, user, recordAction);
        return (await authorizer)(project);
      })();
      decisions.set(projectId, decision);
    }
    return decision;
  };
}

export async function withTaskCommentAccess<T>(
  db: Knex,
  tenant: string,
  user: IUserWithRoles,
  target: TaskCommentTarget,
  action: TaskCommentAction,
  work: (ctx: TaskCommentAccessContext) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await assertCoarse(trx, user, action);

    const byComment = 'taskCommentId' in target;
    const notFound = byComment ? NOT_FOUND.comment : NOT_FOUND.task;
    const writes = action === 'create' || action === 'update' || action === 'delete';

    let comment: CommentRow | undefined;
    let taskId: string;
    if (byComment) {
      [comment] = await resolveComments(trx, tenant, [target.taskCommentId]);
      if (!comment) throw new Error(notFound);
      taskId = comment.task_id;
    } else {
      taskId = target.taskId;
    }

    const [task] = await resolveTasks(trx, tenant, [taskId]);
    if (!task) throw new Error(notFound);

    const decide = projectDecider(trx, tenant, user, writes ? 'update' : 'read');
    if (!(await decide(task.project_id))) throw new Error(notFound);

    if (comment && (action === 'update' || action === 'delete') && comment.user_id !== user.user_id) {
      // Someone else's comment: the caller needs project-task update authority too. The record-level
      // update decision over the parent project was already made above (writes use the update action).
      if (!(await hasPermission(user, 'project_task', 'update', trx))) {
        throw new Error(`You can only ${action === 'update' ? 'edit' : 'delete'} your own comments`);
      }
    }

    return work({ trx, taskId, projectId: task.project_id, ...(comment ? { comment } : {}) });
  });
}

/** Read-level batch access: returns only the ids whose parent project the caller may read. */
export async function withTaskCommentBatchReadAccess<T>(
  db: Knex,
  tenant: string,
  user: IUserWithRoles,
  target: TaskCommentBatchTarget,
  action: 'read',
  work: (ctx: TaskCommentBatchAccessContext) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await assertCoarse(trx, user, action);
    const decide = projectDecider(trx, tenant, user, 'read');

    let allowed: string[];
    if ('taskIds' in target) {
      const tasks = await resolveTasks(trx, tenant, target.taskIds);
      const flags = await Promise.all(tasks.map((t) => decide(t.project_id)));
      allowed = tasks.filter((_, i) => flags[i]).map((t) => t.task_id);
    } else {
      const comments = await resolveComments(trx, tenant, target.taskCommentIds);
      const tasks = await resolveTasks(trx, tenant, [...new Set(comments.map((c) => c.task_id))]);
      const projectByTask = new Map(tasks.map((t) => [t.task_id, t.project_id]));
      const flags = await Promise.all(comments.map(async (c) => {
        const projectId = projectByTask.get(c.task_id);
        return projectId ? decide(projectId) : false;
      }));
      allowed = comments.filter((_, i) => flags[i]).map((c) => c.task_comment_id);
    }

    return work({ trx, ids: allowed });
  });
}

/**
 * The one authorization boundary for project task comments. Every comment
 * operation, from the web server actions and the REST controller alike, runs
 * inside `withTaskCommentAccess`:
 *
 *   1. coarse `project_task:*` permission (a record-level pass never rescues a caller without it),
 *   2. resolve the target to its parent project inside one transaction, tenant-scoped,
 *   3. the record-level project authorizer (read for read/react, update for writes),
 *   4. for update/delete of someone else's comment, an MSP principal with project-task update
 *      authority (client users may only edit/delete their own comments),
 *   5. only then the caller's work, on the same transaction.
 *
 * A missing task/comment and a project the caller may not access throw the same
 * error, so ids cannot be probed.
 */

import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isMspPrincipalUserType } from '@alga-psa/types';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import ProjectModel from '../../models/project';
import { createProjectReadAuthorizer } from '../projectReadAuthorization';
import { collaborationActive, resolveTaskCommentCollaboration, type TaskCommentCollaboration } from './taskCommentCollaboration';

export type TaskCommentAction = 'read' | 'create' | 'update' | 'delete' | 'react';

export type TaskCommentTarget = { taskId: string } | { taskCommentId: string };
/** Batch reads: unauthorized ids are dropped from the context rather than rejected. */
export type TaskCommentBatchTarget = { taskIds: string[] } | { taskCommentIds: string[] };

export type TaskCommentAccessRow = { taskId: string; projectId: string };
export type TaskCommentAccessContext = TaskCommentAccessRow & {
  trx: Knex.Transaction;
  /** user_id is null for collaborator- and contact-authored rows. */
  comment?: { task_comment_id: string; task_id: string; user_id: string | null };
  /** Present only for an active co-managed workspace (see taskCommentCollaboration.ts). */
  collaboration?: TaskCommentCollaboration;
};
export type TaskCommentBatchAccessContext = {
  trx: Knex.Transaction;
  /** Authorized task ids (taskIds target) or comment ids (taskCommentIds target). */
  ids: string[];
  /** Present only for an active co-managed workspace; admits exactly `ids`' tasks. */
  collaboration?: TaskCommentCollaboration;
  /** comment id -> task id, for per-task redaction of a comment batch. */
  taskIdByComment?: ReadonlyMap<string, string>;
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
type CommentRow = { task_comment_id: string; task_id: string; user_id: string | null };

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
      // Someone else's comment: only an MSP principal with project-task update authority. Client users
      // are limited to their own comments whatever their RBAC grants. The record-level update decision
      // over the parent project was already made above (writes use the update action).
      if (!isMspPrincipalUserType(user.user_type) || !(await hasPermission(user, 'project_task', 'update', trx))) {
        throw new Error(`You can only ${action === 'update' ? 'edit' : 'delete'} your own comments`);
      }
    }

    // Co-managed workspaces only: null (and no statement issued) for every other tenant.
    const collaboration = await resolveTaskCommentCollaboration(db, trx, tenant, user, [taskId], writes || action === 'react' ? 'update' : 'read');
    const result = await work({ trx, taskId, projectId: task.project_id, ...(comment ? { comment } : {}), ...(collaboration ? { collaboration } : {}) });
    await collaboration?.assertCurrent();
    return result;
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

    let collaboration: TaskCommentCollaboration | null = null;
    let taskIdByComment: Map<string, string> | undefined;
    if (allowed.length > 0 && await collaborationActive(db, tenant)) {
      let taskIds: string[];
      if ('taskIds' in target) {
        taskIds = allowed;
      } else {
        const rows = await resolveComments(trx, tenant, allowed);
        taskIdByComment = new Map(rows.map((row) => [row.task_comment_id, row.task_id]));
        taskIds = [...new Set(rows.map((row) => row.task_id))];
      }
      collaboration = await resolveTaskCommentCollaboration(db, trx, tenant, user, taskIds, 'read');
    }
    const result = await work({ trx, ids: allowed, ...(collaboration ? { collaboration, ...(taskIdByComment ? { taskIdByComment } : {}) } : {}) });
    await collaboration?.assertCurrent();
    return result;
  });
}

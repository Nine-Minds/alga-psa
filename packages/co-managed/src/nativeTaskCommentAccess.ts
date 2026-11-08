import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, authorizeCoManagedWorkRecord,
  CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

// Comment body/author sources a project policy may redact. L4c owns the full conversation vocabulary;
// admission only needs the field names that make a task's comments unreadable or unattributable.
const COMMENT_BODY_SOURCES = ['body', 'note', 'markdown_content', 'project_task_comments', 'comment_threads', 'task_comment_id', 'task_id'] as const;
const COMMENT_AUTHOR_SOURCES = ['author', 'user_id', 'actor_reference_id'] as const;

/** Rows located per keyset page. The locator is bounded by this, never by the caller's list size. */
export const CO_MANAGED_TASK_LOCATOR_PAGE = 500;

export interface CoManagedNativeTaskCommentAccess {
  /** The requested tasks that exist in this workspace, after the locked re-walk. */
  taskIds: readonly string[];
  hidden(taskId: string, fields: readonly string[]): boolean;
  assertCurrent(): Promise<void>;
}

/** Which tasks a reader is asking about: a caller-supplied id set (any size) or every task of one project. */
export type CoManagedTaskLocator = { taskIds: readonly string[] } | { projectId: string };

/**
 * Keyset walk: `task_id > cursor ORDER BY task_id LIMIT page`, bounded by the project relation
 * (phase -> project) and, for an id set, by a single `uuid[]` bind (`= ANY(?)`), so the number of
 * ids cannot exceed a statement's parameter limit and nothing is rejected for being large.
 * The reference capped the caller array at 1000 and refused the whole batch beyond it, which broke
 * board comment counts above 1000 tasks (T0 §4 #18).
 */
async function locate(trx: Knex.Transaction, tenant: string, locator: { ids: string[] } | { projectId: string }, lock: 'update' | 'share' | null): Promise<Map<string, string>> {
  const owner = tenantDb(trx, tenant), located = new Map<string, string>();
  let cursor: string | null = null;
  for (;;) {
    const query = owner.table('project_tasks as task').orderBy('task.task_id').limit(CO_MANAGED_TASK_LOCATOR_PAGE);
    owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    if ('ids' in locator) query.whereRaw('task.task_id = ANY(?::uuid[])', [locator.ids]); else query.where('phase.project_id', locator.projectId);
    if (cursor) query.where('task.task_id', '>', cursor);
    if (lock === 'update') query.forUpdate('task', 'phase'); else if (lock === 'share') query.forShare('task', 'phase');
    const rows: Array<{ task_id: string; project_id: string }> = await query.select('task.task_id', 'phase.project_id');
    for (const row of rows) located.set(row.task_id, row.project_id);
    if (rows.length < CO_MANAGED_TASK_LOCATOR_PAGE) return located;
    cursor = rows[rows.length - 1].task_id;
  }
}

/** Customer-owned comments remain readable after live trust ends. A local reader needs its own
 * current session/project authority, not the former MSP's grant. */
export async function admitCoManagedNativeTaskCommentAccess(trx: Knex.Transaction, inputActor: CoManagedSessionActor,
  locator: CoManagedTaskLocator, action: 'read' | 'update'): Promise<CoManagedNativeTaskCommentAccess> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  const byProject = Boolean(locator) && 'projectId' in locator;
  if (!trx.isTransaction || !['read', 'update'].includes(action) || !locator ||
      (byProject ? !isCoManagedUuid((locator as { projectId: string }).projectId)
        : !Array.isArray((locator as { taskIds: string[] }).taskIds) || !(locator as { taskIds: string[] }).taskIds.every(isCoManagedUuid))) throw new CoManagedSharedWorkError();
  const lock = action === 'update' ? 'update' : 'share';
  const owner = tenantDb(trx, actor.tenant);
  const request = byProject ? { projectId: (locator as { projectId: string }).projectId.toLowerCase() }
    : { ids: [...new Set((locator as { taskIds: string[] }).taskIds.map(id => id.toLowerCase()))].sort() };
  if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant); else await getCoManagedOperationalState(trx, actor.tenant);
  const tenant = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedSessionIdentity(trx, actor);
  const located = await locate(trx, actor.tenant, request, null);
  // An id that is not a task of this workspace is simply absent (it has no comments and discloses nothing);
  // access is decided over the tasks that do exist, so one stale board id cannot blank every count.
  const projectIds = [...new Set(located.values())].sort();
  const records = projectIds.length ? await (() => {
    const projects = owner.table('projects').whereIn('project_id', projectIds).orderBy('project_id');
    if (action === 'update') projects.forUpdate(); else projects.forShare();
    return projects.select('project_id', 'client_id', 'assigned_to');
  })() : [];
  if (records.length !== projectIds.length) throw new CoManagedSharedWorkError();
  // Re-walk under row locks: a task that moved between the two passes denies the batch.
  const confirmed = await locate(trx, actor.tenant, request, lock);
  if (confirmed.size !== located.size || [...confirmed].some(([taskId, projectId]) => located.get(taskId) !== projectId)) throw new CoManagedSharedWorkError();
  const policies = new Map<string, readonly string[]>();
  for (const project of records) {
    // LEVERAGE: pattern customer-project-policy-record — native task entry points and qualified customer work must use the same actual parent project.
    const record = { id: project.project_id, clientId: project.client_id, assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] };
    const fields: string[] = [];
    for (const permission of action === 'update' ? ['read', 'update'] as const : ['read'] as const) {
      const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'project', permission, record);
      fields.push(...decision.redactedFields);
    }
    if (isCoManagedReadFieldHidden(fields, [...COMMENT_BODY_SOURCES])) throw new CoManagedSharedWorkError();
    policies.set(project.project_id, fields);
  }
  const assertCurrent = async () => { await assertCoManagedSessionUnexpired(trx, actor); if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant); };
  await assertCurrent();
  return { taskIds: [...confirmed.keys()], assertCurrent, hidden(taskId, fields) {
    const projectId = confirmed.get(taskId.toLowerCase()), policy = projectId ? policies.get(projectId) : undefined;
    if (!policy) throw new CoManagedSharedWorkError();
    return isCoManagedReadFieldHidden(policy, fields.includes('author') ? [...fields, ...COMMENT_AUTHOR_SOURCES] : fields);
  } };
}

/**
 * Board comment counts for a co-managed workspace: one transaction admits the readers (keyset locator,
 * no id-count cap) and counts with a single `= ANY(uuid[])` bind. Comment bodies are not read.
 */
export async function countCoManagedNativeTaskComments(db: Knex, inputActor: CoManagedSessionActor, taskIds: readonly string[]): Promise<Record<string, number>> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withTransaction(db, async trx => {
    const access = await admitCoManagedNativeTaskCommentAccess(trx, actor, { taskIds }, 'read');
    const counts: Record<string, number> = {};
    for (let offset = 0; offset < access.taskIds.length; offset += 5000) {
      const rows = await tenantDb(trx, actor.tenant).table('project_task_comments')
        .whereRaw('task_id = ANY(?::uuid[])', [access.taskIds.slice(offset, offset + 5000)]).groupBy('task_id').select('task_id').count('* as count');
      for (const row of rows) counts[row.task_id as string] = parseInt(row.count as string) || 0;
    }
    await access.assertCurrent();
    return counts;
  });
}

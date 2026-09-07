import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, authorizeCoManagedWorkRecord,
  CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { coManagedConversationBodySources, coManagedConversationAuthorSources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedNativeTaskCommentAccess {
  hidden(taskId: string, fields: readonly string[]): boolean;
  assertCurrent(): Promise<void>;
}
/** Customer-owned comments remain readable after live trust ends. A local
 * reader needs its own current session/project authority, not the former MSP's
 * grant. Retained ownership also applies after a paid PSA upgrade. */
export async function admitCoManagedNativeTaskCommentAccess(trx: Knex.Transaction, inputActor: CoManagedSessionActor,
  inputTaskIds: readonly string[], action: 'read' | 'update'): Promise<CoManagedNativeTaskCommentAccess> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!trx.isTransaction || !['read', 'update'].includes(action) || !Array.isArray(inputTaskIds) || inputTaskIds.length > 1000 || !inputTaskIds.every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const taskIds = [...new Set(inputTaskIds.map(id => id.toLowerCase()))].sort(), owner = tenantDb(trx, actor.tenant);
  if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant); else await getCoManagedOperationalState(trx, actor.tenant);
  const tenant = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedSessionIdentity(trx, actor);
  const locate = owner.table('project_tasks as task').whereIn('task.task_id', taskIds);
  owner.tenantJoin(locate, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  const locators = await locate.select('task.task_id', 'phase.project_id');
  if (locators.length !== taskIds.length) throw new CoManagedSharedWorkError();
  const projectIds = [...new Set(locators.map(row => row.project_id))].sort();
  const projects = owner.table('projects').whereIn('project_id', projectIds).orderBy('project_id');
  if (action === 'update') projects.forUpdate(); else projects.forShare();
  const records = await projects.select('project_id', 'client_id', 'assigned_to');
  if (records.length !== projectIds.length) throw new CoManagedSharedWorkError();
  const confirmed = owner.table('project_tasks as task').whereIn('task.task_id', taskIds).orderBy('task.task_id');
  owner.tenantJoin(confirmed, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  if (action === 'update') confirmed.forUpdate('task', 'phase'); else confirmed.forShare('task', 'phase');
  const tasks = await confirmed.select('task.task_id', 'phase.project_id');
  if (tasks.length !== taskIds.length || tasks.some(task => locators.find(row => row.task_id === task.task_id)?.project_id !== task.project_id)) throw new CoManagedSharedWorkError();
  const policies = new Map<string, readonly string[]>();
  for (const project of records) {
    // LEVERAGE: pattern customer-project-policy-record — native task entry points and qualified customer work must use the same actual parent project.
    const record = { id: project.project_id, clientId: project.client_id, assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] };
    const fields: string[] = [];
    for (const permission of action === 'update' ? ['read', 'update'] as const : ['read'] as const) {
      const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'project', permission, record);
      fields.push(...decision.redactedFields);
    }
    if (isCoManagedReadFieldHidden(fields, [...coManagedConversationBodySources, 'project_task_comments', 'comment_threads', 'task_comment_id', 'task_id'])) throw new CoManagedSharedWorkError();
    for (const task of tasks.filter(row => row.project_id === project.project_id)) policies.set(task.task_id, fields);
  }
  const assertCurrent = async () => { await assertCoManagedSessionUnexpired(trx, actor); if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant); };
  await assertCurrent();
  return { assertCurrent, hidden(taskId, fields) {
    const policy = policies.get(taskId.toLowerCase()); if (!policy) throw new CoManagedSharedWorkError();
    return isCoManagedReadFieldHidden(policy, fields.includes('author') ? [...fields, ...coManagedConversationAuthorSources] : fields);
  } };
}

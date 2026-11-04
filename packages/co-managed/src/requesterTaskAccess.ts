import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';

const deny = (): never => { throw new CoManagedSharedWorkError(); };
export interface RequesterTaskTarget { projectId: string; taskId: string }
export interface RequesterTaskRecipient { kind: 'requester_task_recipient'; tenant: string; userId: string }
type Actor = CoManagedSessionActor | RequesterTaskRecipient;
type Access<A extends Actor> = { trx: Knex.Transaction; actor: A; target: RequesterTaskTarget; user: any; canWrite: boolean; assertCurrent(): Promise<void> };
export type RequesterTaskSessionAccess = Access<CoManagedSessionActor>;
export type RequesterTaskRecipientAccess = Access<RequesterTaskRecipient>;
function targetSnapshot(input: RequesterTaskTarget): RequesterTaskTarget {
  if (!input || Object.keys(input).some(key => !['projectId', 'taskId'].includes(key)) || ![input.projectId, input.taskId].every(isCoManagedUuid)) deny();
  return { projectId: input.projectId.toLowerCase(), taskId: input.taskId.toLowerCase() };
}
async function portalPermission(trx: Knex.Transaction, actor: Actor, resource: string, action: string) {
  const own = tenantDb(trx, actor.tenant), query = own.table('user_roles as ur').where('ur.user_id', actor.userId);
  own.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
  own.tenantJoin(query, 'role_permissions as rp', 'r.role_id', 'rp.role_id');
  own.tenantJoin(query, 'permissions as p', 'rp.permission_id', 'p.permission_id');
  return Boolean(await query.where({ 'r.client': true, 'p.client': true, 'p.resource': resource, 'p.action': action }).forShare().first('p.permission_id'));
}

/** Browser writes still require a tracked, unexpired requester session. */
export function withRequesterTaskAccess<T>(db: Knex, inputActor: CoManagedSessionActor, input: RequesterTaskTarget,
  write: boolean, work: (context: RequesterTaskSessionAccess) => Promise<T>): Promise<T> {
  return withRequesterTaskPrincipal(db, snapshotCoManagedSessionActor(inputActor), targetSnapshot(input), write, work);
}
/** Background mail gets only a current owner's read boundary, never a borrowed
 * session or a write principal. No live MSP relationship is required. */
export function withRequesterTaskRecipientAccess<T>(db: Knex, input: RequesterTaskRecipient, target: RequesterTaskTarget,
  work: (context: RequesterTaskRecipientAccess) => Promise<T>): Promise<T> {
  if (!input || input.kind !== 'requester_task_recipient' || ![input.tenant, input.userId].every(isCoManagedUuid)) deny();
  const actor: RequesterTaskRecipient = { kind: 'requester_task_recipient', tenant: input.tenant.toLowerCase(), userId: input.userId.toLowerCase() };
  return withRequesterTaskPrincipal(db, actor, targetSnapshot(target), false, work);
}

async function withRequesterTaskPrincipal<T, A extends Actor>(db: Knex, actor: A, target: RequesterTaskTarget,
  write: boolean, work: (context: Access<A>) => Promise<T>): Promise<T> {
  if (write && actor.kind !== 'session') deny();
  return withTransaction(db, async trx => {
    const lifecycle = await getCoManagedOperationalState(trx, actor.tenant);
    if (write) await assertCoManagedOperationalWrite(trx, actor.tenant);
    const own = tenantDb(trx, actor.tenant), workspace = await own.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!workspace || !['psa', 'co_managed'].includes(workspace.product_code) || workspace.suspended_at) deny();
    const user = await own.table('users').where({ user_id: actor.userId, user_type: 'client', is_inactive: false }).forShare().first();
    if (!user?.contact_id) deny();
    if (actor.kind === 'session') {
      if (!await own.table('sessions').where({ session_id: actor.sessionId, user_id: actor.userId }).whereNull('revoked_at').forShare().first('session_id')) deny();
      await assertCoManagedSessionUnexpired(trx, actor);
    }
    const contact = await own.table('contacts').where('contact_name_id', user.contact_id).forShare().first('client_id', 'is_inactive');
    if (!contact?.client_id || contact.is_inactive === true || !await portalPermission(trx, actor, 'project', 'read')) deny();
    const projectQuery = own.table('projects').where({ project_id: target.projectId, client_id: contact.client_id, is_inactive: false });
    const project = await (write ? projectQuery.forUpdate() : projectQuery.forShare()).first('client_portal_config');
    if (!project || (project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG).show_tasks !== true) deny();
    const task = own.table('project_tasks as task').where('task.task_id', target.taskId);
    own.tenantJoin(task, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    task.where('phase.project_id', target.projectId);
    if (!await (write ? task.forUpdate('task', 'phase') : task.forShare('task', 'phase')).first('task.task_id')) deny();
    const canWrite = actor.kind === 'session' && lifecycle.canWrite && await portalPermission(trx, actor, 'project_task_comment', 'create');
    if (write && !canWrite) deny();
    const assertCurrent = async () => { if (actor.kind === 'session') await assertCoManagedSessionUnexpired(trx, actor); if (write) await assertCoManagedOperationalWrite(trx, actor.tenant); };
    await assertCurrent();
    const result = await work({ trx, actor, target, user, canWrite, assertCurrent });
    await assertCurrent(); return result;
  });
}

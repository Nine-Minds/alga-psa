import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, isCoManagedLifecycleError } from '@alga-psa/licensing';
import { withCoManagedCustomerProject } from './customerWork';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired,
  type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedAssigneeOption } from './sharedWorkAssignees';
import { recordCoManagedProjectTaskAudit } from './projectTaskAudit';

export interface CoManagedTaskAssignee { tenant: string; kind: 'user' | 'team'; id: string }
export interface CoManagedTaskAssigneeOption extends CoManagedTaskAssignee { name: string; organizationName: string }
export interface CoManagedTaskAssignmentRequest { operationId: string; expectedRevision: number; assignee: CoManagedTaskAssignee | null }
export class CoManagedTaskAssignmentError extends Error {
  constructor(readonly code: 'INVALID_TASK_ASSIGNMENT' | 'TASK_ASSIGNMENT_CONFLICT' | 'TASK_ASSIGNMENT_OPERATION_CONFLICT') { super(code); }
}
const denied = () => { throw new CoManagedSharedWorkError(); };
const boundary = (actor: CoManagedSessionActor, resource: CoManagedSharedResource) => actor.tenant === resource.tenant ? withCoManagedCustomerProject : withCoManagedSharedWork;
const hidden = (context: CoManagedSharedWorkContext) => isCoManagedReadFieldHidden(context.redactedFields,
  ['mspAssignment', 'msp_assignment', 'assignee', 'users', 'teams', 'tenants', 'assignee_name', 'organization_name', 'assigned_to', 'assigned_team_id', 'project_tasks.assigned_to', 'project_tasks.assigned_team_id', 'co_managed_project_task_references']);
function resourceSnapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'project_task' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) denied();
  return { kind: 'project_task', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
async function current(context: CoManagedSharedWorkContext, write = false) {
  await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
  if (write) await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
}
async function relationship(context: CoManagedSharedWorkContext) {
  const row = await tenantDb(context.trx, context.resource.tenant).table('co_management_relationships').where({ relationship_id: context.resource.relationshipId, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_tenant', 'sponsor_client_id');
  if (!row) denied();
  return row;
}
function referenceQuery(context: CoManagedSharedWorkContext, sponsorTenant: string) {
  return tenantDb(context.trx, sponsorTenant).table('co_managed_project_task_references').where({ customer_tenant: context.resource.tenant,
    relationship_id: context.resource.relationshipId, task_id: context.resource.id });
}
async function taskContext(context: CoManagedSharedWorkContext) {
  const owner = tenantDb(context.trx, context.resource.tenant), query = owner.table('project_tasks as task').where('task.task_id', context.resource.id);
  owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  owner.tenantJoin(query, 'projects as project', 'phase.project_id', 'project.project_id');
  const row = await query.first('task.task_name', 'phase.project_id', 'project.project_name');
  if (!row) denied();
  return row;
}
async function requireProjectSharing(context: CoManagedSharedWorkContext) {
  const task = await taskContext(context);
  if (!await tenantDb(context.trx, context.resource.tenant).table('co_management_project_scopes').where({ relationship_id: context.resource.relationshipId,
    project_id: task.project_id, can_collaborate: true }).forShare().first('project_id')) denied();
  return task;
}
const assigneeOption = (context: CoManagedSharedWorkContext, relation: any, assignee: CoManagedTaskAssignee) =>
  coManagedAssigneeOption(context, relation, assignee, { hidden: fields => hidden({ ...context, redactedFields: fields }) });
async function assignmentState(context: CoManagedSharedWorkContext, canEdit: boolean) {
  if (hidden(context)) return { resource: context.resource, canEdit: false };
  const relation = await relationship(context), row = await referenceQuery(context, relation.sponsor_tenant).forShare().first();
  let canAssign = canEdit;
  if (canAssign) try { await requireProjectSharing(context); } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; canAssign = false; }
  await current(context, canEdit);
  return { resource: context.resource, canEdit, canAssign, revision: row?.revision ?? 0, mspAssignment: row?.active ? {
    tenant: relation.sponsor_tenant as string, kind: row.assigned_to ? 'user' as const : 'team' as const, id: (row.assigned_to ?? row.assigned_team_id) as string,
    name: row.assignee_name as string, organizationName: row.organization_name as string } : null };
}
export async function getCoManagedProjectTaskAssignment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), withWork = boundary(actor, resource);
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', read => assignmentState(read, !hidden(write)))); }
  catch (error) {
    if (!(error instanceof CoManagedSharedWorkError) && !isCoManagedLifecycleError(error)) throw error;
    return withWork(db, actor, resource, 'read', context => assignmentState(context, false));
  }
}
export async function listCoManagedProjectTaskAssignees(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, kind: 'user' | 'team', afterId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), withWork = boundary(actor, resource);
  if (!['user', 'team'].includes(kind) || (afterId !== undefined && !isCoManagedUuid(afterId))) denied();
  return withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (hidden(write) || hidden(read)) denied(); await requireProjectSharing(write);
    const relation = await relationship(write), home = tenantDb(write.trx, relation.sponsor_tenant), items: CoManagedTaskAssigneeOption[] = [];
    const key = kind === 'user' ? 'user_id' : 'team_id'; let scanned = afterId;
    // LEVERAGE: pattern co-managed-assignee-pagination — source scans differ from eligible option pages; keep the candidate boundary shared.
    while (items.length < 26) {
      const query = home.table(kind === 'user' ? 'users' : 'teams').orderBy(key).limit(50);
      if (kind === 'user') query.where({ user_type: 'internal', is_inactive: false });
      if (scanned) query.where(key, '>', scanned);
      const rows = await query.select(key); if (!rows.length) break;
      for (const row of rows) {
        scanned = row[key];
        try { items.push(await assigneeOption(write, relation, { tenant: relation.sponsor_tenant, kind, id: row[key] })); }
        catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
        if (items.length === 26) break;
      }
      if (rows.length < 50) break;
    }
    await current(write, true);
    return { options: items.slice(0, 25), nextAfterId: items.length > 25 ? items[24].id : null };
  }));
}
export async function assignCoManagedProjectTask(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, input: CoManagedTaskAssignmentRequest) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), withWork = boundary(actor, resource);
  const invalid = () => { throw new CoManagedTaskAssignmentError('INVALID_TASK_ASSIGNMENT'); };
  if (!input || !isCoManagedUuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
    Object.keys(input).some(key => !['operationId', 'expectedRevision', 'assignee'].includes(key))) invalid();
  const candidate = input.assignee;
  if (candidate !== null && (!candidate || !['user', 'team'].includes(candidate.kind) || ![candidate.tenant, candidate.id].every(isCoManagedUuid) ||
    Object.keys(candidate).some(key => !['tenant', 'kind', 'id'].includes(key)))) invalid();
  const request = { operationId: input.operationId.toLowerCase(), expectedRevision: input.expectedRevision,
    assignee: candidate ? { tenant: candidate.tenant.toLowerCase(), kind: candidate.kind, id: candidate.id.toLowerCase() } : null };
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, command: 'project_task_assignment', request })).digest('hex');
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (hidden(write) || hidden(read)) denied();
    const owner = tenantDb(write.trx, resource.tenant), relation = await relationship(write);
    const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
    if (previous) {
      if (previous.request_hash !== hash) throw new CoManagedTaskAssignmentError('TASK_ASSIGNMENT_OPERATION_CONFLICT');
      await current(write, true); return { operationId: request.operationId, appliedAt: new Date(previous.applied_at).toISOString() };
    }
    const existing = await referenceQuery(write, relation.sponsor_tenant).forUpdate().first();
    if ((existing?.revision ?? 0) !== request.expectedRevision) throw new CoManagedTaskAssignmentError('TASK_ASSIGNMENT_CONFLICT');
    if (!request.assignee && !existing?.active) invalid();
    const task = request.assignee ? await requireProjectSharing(write) : await taskContext(write);
    const selected = request.assignee ? await assigneeOption(write, relation, request.assignee) : null;
    await current(write, true);
    const referenceId = existing?.reference_id ?? randomUUID(), revision = (existing?.revision ?? 0) + 1;
    if (selected) {
      const values = { client_id: relation.sponsor_client_id, active: true, revision,
        assigned_to: selected.kind === 'user' ? selected.id : null, assigned_team_id: selected.kind === 'team' ? selected.id : null,
        assignee_name: selected.name, organization_name: selected.organizationName,
        task_name: isCoManagedReadFieldHidden(read.redactedFields, ['task_name', 'values.task_name', 'project_tasks.task_name']) ? '' : task.task_name,
        project_name: isCoManagedReadFieldHidden(read.redactedFields, ['project', 'projectName', 'project_id', 'project_name', 'projects']) ? '' : task.project_name,
        updated_at: write.trx.raw('clock_timestamp()') };
      if (existing) await referenceQuery(write, relation.sponsor_tenant).update(values);
      else await tenantDb(write.trx, relation.sponsor_tenant).table('co_managed_project_task_references').insert({ ...values, tenant: relation.sponsor_tenant,
        reference_id: referenceId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId, task_id: resource.id, created_at: write.trx.raw('clock_timestamp()') });
    } else await referenceQuery(write, relation.sponsor_tenant).update({ active: false, revision, updated_at: write.trx.raw('clock_timestamp()') });
    await recordCoManagedProjectTaskAudit(write, { operation: 'co_managed_project_task_assignment', operationId: request.operationId,
      changes: { msp_assignment: selected ? `${selected.organizationName} · ${selected.name}` : null },
      details: { assignment_reference_id: referenceId, assignment_revision: revision, assignee: request.assignee } });
    await current(write, true);
    const [receipt] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId,
      relationship_id: resource.relationshipId, resource_type: 'project_task', resource_id: resource.id, actor_tenant: actor.tenant,
      actor_user_id: actor.userId, command_type: 'project_task_assignment', request_hash: hash, applied_at: write.trx.raw('clock_timestamp()') }).returning('applied_at');
    return { operationId: request.operationId, appliedAt: new Date(receipt.applied_at).toISOString() };
  })); } catch (error) {
    if ((error as any)?.code === '23505' && (error as any)?.constraint === 'co_management_command_receipts_pkey') throw new CoManagedTaskAssignmentError('TASK_ASSIGNMENT_OPERATION_CONFLICT');
    throw error;
  }
}

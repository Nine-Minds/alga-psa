import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, isCoManagedLifecycleError } from '@alga-psa/licensing';
import { withCoManagedCustomerProject } from './customerWork';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { ensureCoManagedActorReference } from './actorReferences';

const fields = ['task_name', 'due_date', 'project_status_mapping_id'] as const;
export type CoManagedTaskEditField = typeof fields[number];
export type CoManagedTaskEditPatch = Partial<Record<CoManagedTaskEditField, string | null>>;
export interface CoManagedTaskEditRequest { operationId: string; expected: CoManagedTaskEditPatch; patch: CoManagedTaskEditPatch }
export interface CoManagedTaskEditReceipt { operationId: string; appliedAt: string }
export interface CoManagedTaskEditorState { resource: CoManagedSharedResource; values: CoManagedTaskEditPatch; editableFields: CoManagedTaskEditField[];
  selectedStatus: { id: string; name: string } | null; projectName?: string; phaseName?: string; organizationName?: string }
export class CoManagedTaskEditError extends Error {
  constructor(readonly code: 'INVALID_TASK_EDIT' | 'TASK_EDIT_CONFLICT' | 'TASK_EDIT_OPERATION_CONFLICT') { super(code); this.name = 'CoManagedTaskEditError'; }
}
function taskResource(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'project_task' || ![input.tenant, input.id, input.relationshipId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return { kind: 'project_task', tenant: input.tenant.toLowerCase(), id: input.id.toLowerCase(), relationshipId: input.relationshipId.toLowerCase() };
}
function snapshotRequest(input: CoManagedTaskEditRequest): CoManagedTaskEditRequest {
  const invalid = () => { throw new CoManagedTaskEditError('INVALID_TASK_EDIT'); };
  if (!input || !isCoManagedUuid(input.operationId) || Object.keys(input).some(key => !['operationId', 'expected', 'patch'].includes(key))) invalid();
  for (const value of [input.expected, input.patch]) if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !fields.includes(field as CoManagedTaskEditField))) invalid();
  const keys = fields.filter(field => Object.hasOwn(input.patch, field));
  if (!keys.length || keys.length !== Object.keys(input.expected).length || keys.some(field => !Object.hasOwn(input.expected, field))) invalid();
  const expected: CoManagedTaskEditPatch = {}, patch: CoManagedTaskEditPatch = {};
  for (const field of keys) {
    const before = input.expected[field], after = input.patch[field];
    if ((before !== null && typeof before !== 'string') || (after !== null && typeof after !== 'string') ||
      (typeof before === 'string' && (before.length > 1000 || before.includes('\0'))) || (typeof after === 'string' && after.includes('\0'))) invalid();
    if (field === 'task_name' && (typeof after !== 'string' || !after.trim() || after.length > 255)) invalid();
    if (field === 'project_status_mapping_id' && !isCoManagedUuid(after)) invalid();
    if (field === 'due_date' && after !== null && (typeof after !== 'string' || !Number.isFinite(Date.parse(after)) || new Date(after).toISOString() !== after)) invalid();
    expected[field] = before!; patch[field] = after!;
  }
  return { operationId: input.operationId.toLowerCase(), expected, patch };
}
const normalize = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
function hidden(context: CoManagedSharedWorkContext, field: CoManagedTaskEditField) {
  return isCoManagedReadFieldHidden(context.redactedFields, [field, `values.${field}`, `project_tasks.${field}`,
    ...(field === 'project_status_mapping_id' ? ['status', 'selectedStatus', 'status_id', 'status_name', 'project_status_mappings', 'statuses', 'standard_statuses'] : [])]);
}
const boundary = (actor: CoManagedSessionActor, resource: CoManagedSharedResource) => actor.tenant === resource.tenant ? withCoManagedCustomerProject : withCoManagedSharedWork;
async function taskRow(context: CoManagedSharedWorkContext) {
  const owner = tenantDb(context.trx, context.resource.tenant);
  const query = owner.table('project_tasks as task').where('task.task_id', context.resource.id);
  owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  owner.tenantJoin(query, 'projects as project', 'phase.project_id', 'project.project_id');
  const row = await query.first(...fields.map(field => `task.${field}`), 'task.phase_id', 'phase.project_id', 'phase.phase_name', 'project.project_name');
  if (!row) throw new CoManagedSharedWorkError();
  return row;
}
// LEVERAGE: pattern project-effective-status-scope — phase mappings override project fallback, as in native task actions.
function statusQuery(context: CoManagedSharedWorkContext, row: any) {
  const owner = tenantDb(context.trx, context.resource.tenant);
  const query = owner.table('project_status_mappings as mapping').where('mapping.project_id', row.project_id)
    .where(scope => scope.where('mapping.phase_id', row.phase_id).orWhere(fallback => fallback.whereNull('mapping.phase_id').whereNotExists(
      owner.table('project_status_mappings as phase_mapping').where({ 'phase_mapping.project_id': row.project_id, 'phase_mapping.phase_id': row.phase_id }).select(context.trx.raw('1')))));
  owner.tenantJoin(query, 'statuses as s', 'mapping.status_id', 's.status_id', { type: 'left' });
  owner.tenantJoin(query, 'standard_statuses as ss', 'mapping.standard_status_id', 'ss.standard_status_id', { type: 'left' });
  return query.where(scope => scope.whereNotNull('s.status_id').orWhereNotNull('ss.standard_status_id'));
}
async function assertCurrent(context: CoManagedSharedWorkContext, write = false) {
  await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
  if (write) await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
}
async function editor(context: CoManagedSharedWorkContext, editableFields: CoManagedTaskEditField[] = []): Promise<CoManagedTaskEditorState> {
  const row = await taskRow(context), values: CoManagedTaskEditPatch = {};
  for (const field of fields) if (!hidden(context, field)) values[field] = normalize(row[field]);
  const status = values.project_status_mapping_id ? await statusQuery(context, row).where('mapping.project_status_mapping_id', values.project_status_mapping_id)
    .first('mapping.project_status_mapping_id as id', context.trx.raw('COALESCE(mapping.custom_name, s.name, ss.name) as name')) : null;
  await assertCurrent(context, editableFields.length > 0);
  const labels: { projectName?: string; phaseName?: string; organizationName?: string } = {};
  if (!isCoManagedReadFieldHidden(context.redactedFields, ['project', 'projectName', 'project_id', 'project_name', 'projects'])) labels.projectName = row.project_name;
  if (!isCoManagedReadFieldHidden(context.redactedFields, ['phase', 'phaseName', 'phase_id', 'phase_name', 'project_phases'])) labels.phaseName = row.phase_name;
  if (!isCoManagedReadFieldHidden(context.redactedFields, ['client_name', 'organizationName', 'tenants'])) labels.organizationName =
    (await tenantDb(context.trx, context.resource.tenant).table('tenants').first('client_name'))?.client_name;
  await assertCurrent(context, editableFields.length > 0);
  return { resource: context.resource, values, editableFields, selectedStatus: status ?? null, ...labels };
}
export async function getCoManagedProjectTaskEditor(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource), withWork = boundary(actor, resource);
  try {
    return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', read =>
      editor(read, fields.filter(field => !hidden(write, field) && !hidden(read, field)))));
  } catch (error) {
    if (!(error instanceof CoManagedSharedWorkError) && !isCoManagedLifecycleError(error)) throw error;
    return withWork(db, actor, resource, 'read', read => editor(read));
  }
}
export async function getCoManagedProjectTaskStatuses(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, afterId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource), withWork = boundary(actor, resource);
  if (afterId !== undefined && !isCoManagedUuid(afterId)) throw new CoManagedTaskEditError('INVALID_TASK_EDIT');
  return withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (hidden(write, 'project_status_mapping_id') || hidden(read, 'project_status_mapping_id')) throw new CoManagedSharedWorkError();
    const query = statusQuery(read, await taskRow(read)).orderBy('mapping.project_status_mapping_id').limit(26);
    if (afterId) query.where('mapping.project_status_mapping_id', '>', afterId);
    const rows = await query.select('mapping.project_status_mapping_id as id', read.trx.raw('COALESCE(mapping.custom_name, s.name, ss.name) as name'));
    await assertCurrent(write, true);
    return { options: rows.slice(0, 25) as { id: string; name: string }[], nextAfterId: rows.length > 25 ? rows[24].id as string : null };
  }));
}
export async function editCoManagedProjectTask(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedTaskEditRequest, apply: (context: CoManagedSharedWorkContext, patch: CoManagedTaskEditPatch, actorReferenceId: string | null) => Promise<void>): Promise<CoManagedTaskEditReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource), request = snapshotRequest(input), withWork = boundary(actor, resource);
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, command: 'project_task_edit', request })).digest('hex');
  try {
    return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
      if (Object.keys(request.patch).some(field => hidden(write, field as CoManagedTaskEditField) || hidden(read, field as CoManagedTaskEditField))) throw new CoManagedSharedWorkError();
      const owner = tenantDb(write.trx, resource.tenant), row = await taskRow(write);
      const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
      if (previous) {
        if (previous.request_hash !== hash) throw new CoManagedTaskEditError('TASK_EDIT_OPERATION_CONFLICT');
        return { operationId: request.operationId, appliedAt: normalize(previous.applied_at)! };
      }
      if (Object.entries(request.expected).some(([field, value]) => normalize(row[field]) !== value)) throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT');
      if (request.patch.project_status_mapping_id) {
        const mapping = await owner.table('project_status_mappings').where({ project_status_mapping_id: request.patch.project_status_mapping_id, project_id: row.project_id })
          .where(scope => scope.whereNull('phase_id').orWhere('phase_id', row.phase_id)).forShare().first();
        if (!mapping || !await statusQuery(write, row).where('mapping.project_status_mapping_id', mapping.project_status_mapping_id).first()) throw new CoManagedTaskEditError('INVALID_TASK_EDIT');
      }
      const referenceId = actor.tenant === resource.tenant ? null : await ensureCoManagedActorReference(write);
      await assertCurrent(write, true);
      await apply(write, request.patch, referenceId);
      await assertCurrent(write, true);
      const [receipt] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId,
        relationship_id: resource.relationshipId, resource_type: 'project_task', resource_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId,
        command_type: 'project_task_edit', request_hash: hash, applied_at: write.trx.raw('clock_timestamp()') }).returning('applied_at');
      return { operationId: request.operationId, appliedAt: normalize(receipt.applied_at)! };
    }));
  } catch (error) {
    if ((error as any)?.code === '23505' && (error as any)?.constraint === 'co_management_command_receipts_pkey') throw new CoManagedTaskEditError('TASK_EDIT_OPERATION_CONFLICT');
    throw error;
  }
}

/** Page only currently authorized tasks. A project grant never creates an
 * assignment or grants access to unrelated links, descriptions or timesheets. */
export async function listCoManagedProjectTasks(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, afterId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputResource || inputResource.kind !== 'project' || ![inputResource.tenant, inputResource.relationshipId, inputResource.id].every(isCoManagedUuid) ||
    (afterId !== undefined && !isCoManagedUuid(afterId))) throw new CoManagedSharedWorkError();
  const resource = { ...inputResource }, withWork = boundary(actor, resource);
  return withWork(db, actor, resource, 'read', async context => {
    if (isCoManagedReadFieldHidden(context.redactedFields, ['tasks', 'project_tasks', 'task_id', 'phases', 'project_phases'])) return { items: [], nextAfterId: null };
    const owner = tenantDb(context.trx, resource.tenant), items: CoManagedTaskEditorState[] = [];
    let scanned = afterId;
    while (items.length < 26) {
      const query = owner.table('project_tasks as task');
      owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
      query.where('phase.project_id', resource.id).orderBy('task.task_id').limit(50);
      if (scanned) query.where('task.task_id', '>', scanned);
      const candidates = await query.select('task.task_id');
      if (!candidates.length) break;
      for (const candidate of candidates) {
        scanned = candidate.task_id;
        const task = { ...resource, kind: 'project_task' as const, id: candidate.task_id };
        try {
          const item = await withWork(context.trx, actor, task, 'read', async read => {
            if (isCoManagedReadFieldHidden(read.redactedFields, ['tasks', 'project_tasks', 'task_id'])) return null;
            if ((await taskRow(read)).project_id !== resource.id) return null;
            return editor(read);
          });
          if (item) items.push(item);
        } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
        if (items.length === 26) break;
      }
      if (candidates.length < 50) break;
    }
    await assertCurrent(context);
    return { items: items.slice(0, 25), nextAfterId: items.length > 25 ? items[24].resource.id : null };
  });
}

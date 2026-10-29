import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { readCoManagedCustomerOrganizationName } from './projectTaskQueue';
import { assertCoManagedProjectWorkServed } from './projectTaskGate';
import { coManagedRequestHash, findCoManagedTaskReplay, recordCoManagedTaskAudit } from './projectTaskAudit';

/** Fields an MSP technician may change on a customer's task. Assignment is deliberately absent:
 * it lives on the MSP reference row (projectTaskAssignments.ts), never on the customer's task. */
export const CO_MANAGED_TASK_EDIT_FIELDS = ['task_name', 'project_status_mapping_id', 'due_date'] as const;
export type CoManagedTaskEditField = typeof CO_MANAGED_TASK_EDIT_FIELDS[number];
export type CoManagedTaskEditPatch = Partial<Record<CoManagedTaskEditField, string | null>>;

/** What the caller loaded: the reference `revision` (shared-command concurrency) and the task's
 * `updated_at` as served by the loader (customer-side drift). Both are compared, never written. */
export interface CoManagedTaskEditRequest { /** Client-generated per submit attempt; a repeat of the same id replays the original receipt. */ operationId?: string; expectedRevision: number; expectedTaskUpdatedAt: string; patch: CoManagedTaskEditPatch }
export interface CoManagedTaskEditReceipt { revision: number; taskUpdatedAt: string }
/** `assignee` is the current MSP assignee as a display name and kind only; ids never leave the server. */
export interface CoManagedTaskSnapshot { revision: number; taskUpdatedAt: string; values: CoManagedTaskEditPatch; assignee: { kind: 'user' | 'team'; name: string } | null }
const assigneeOf = (reference: { assigned_to?: string | null; assigned_team_id?: string | null; assignee_name?: string | null }): CoManagedTaskSnapshot['assignee'] =>
  reference.assignee_name ? { kind: reference.assigned_team_id ? 'team' : 'user', name: reference.assignee_name } : null;

export type CoManagedTaskEditErrorCode = 'INVALID_TASK_EDIT' | 'TASK_EDIT_CONFLICT';
/** A conflict carries a fresh snapshot so the editor can reload; it never merges. */
export class CoManagedTaskEditError extends Error {
  constructor(readonly code: CoManagedTaskEditErrorCode, readonly reason?: 'revision' | 'customer_drift', readonly snapshot?: CoManagedTaskSnapshot) {
    super(code); this.name = 'CoManagedTaskEditError';
  }
}

/** Applies the validated patch to the customer's task; wired to the base `ProjectTaskModel.updateTask`
 * by the server composition so this package does not depend on `@alga-psa/projects`. */
export type CoManagedTaskWriter = (trx: Knex.Transaction, customerTenant: string, taskId: string, patch: CoManagedTaskEditPatch) => Promise<void>;

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
const fieldHidden = (redacted: readonly string[], field: CoManagedTaskEditField) => isCoManagedReadFieldHidden(redacted, [field, `values.${field}`, `project_tasks.${field}`,
  ...(field === 'project_status_mapping_id' ? ['status', 'selectedStatus', 'status_id', 'status_name', 'project_status_mappings'] : [])]);

function snapshotRequest(input: CoManagedTaskEditRequest): CoManagedTaskEditRequest {
  const invalid = (): never => { throw new CoManagedTaskEditError('INVALID_TASK_EDIT'); };
  if (!input || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.expectedTaskUpdatedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.expectedTaskUpdatedAt)) || !input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) return invalid();
  const keys = Object.keys(input.patch);
  if (!keys.length || keys.some(key => !(CO_MANAGED_TASK_EDIT_FIELDS as readonly string[]).includes(key))) return invalid();
  const patch: CoManagedTaskEditPatch = {};
  for (const field of CO_MANAGED_TASK_EDIT_FIELDS) {
    if (!Object.hasOwn(input.patch, field)) continue;
    const value = input.patch[field];
    if (value !== null && typeof value !== 'string') invalid();
    if (typeof value === 'string' && value.includes('\0')) invalid();
    if (field === 'task_name' && (typeof value !== 'string' || !value.trim() || value.length > 255)) invalid();
    if (field === 'project_status_mapping_id' && !isCoManagedUuid(value)) invalid();
    if (field === 'due_date' && value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) invalid();
    patch[field] = value;
  }
  if (input.operationId !== undefined && !isCoManagedUuid(input.operationId)) invalid();
  return { operationId: input.operationId?.toLowerCase(), expectedRevision: input.expectedRevision, expectedTaskUpdatedAt: new Date(input.expectedTaskUpdatedAt).toISOString(), patch };
}

function taskResource(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'project_task' || ![input.tenant, input.id, input.relationshipId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return { kind: 'project_task', tenant: input.tenant.toLowerCase(), id: input.id.toLowerCase(), relationshipId: input.relationshipId.toLowerCase() };
}

async function lockTask(trx: Knex.Transaction, resource: CoManagedSharedResource) {
  const owner = tenantDb(trx, resource.tenant);
  const query = owner.table('project_tasks as task').where('task.task_id', resource.id).forUpdate('task');
  owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  const row = await query.first('task.task_name', 'task.due_date', 'task.project_status_mapping_id', 'task.updated_at', 'task.phase_id', 'phase.project_id');
  if (!row) throw new CoManagedSharedWorkError();
  return row;
}
const values = (row: any, redacted: readonly string[]): CoManagedTaskEditPatch => {
  const out: CoManagedTaskEditPatch = {};
  for (const field of CO_MANAGED_TASK_EDIT_FIELDS) if (!fieldHidden(redacted, field)) out[field] = row[field] == null ? null : row[field] instanceof Date ? row[field].toISOString() : String(row[field]);
  return out;
};

/** The task as the editor loads it: values (minus redacted fields) plus both guard tokens. */
export async function getCoManagedProjectTaskSnapshot(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource): Promise<CoManagedTaskSnapshot> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource);
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, resource, 'read', async context => {
    const reference = await referenceRow(context, false);
    const row = await lockTaskShared(context.trx, resource);
    return { revision: reference.revision, taskUpdatedAt: iso(row.updated_at), values: values(row, context.redactedFields), assignee: assigneeOf(reference) };
  });
}
async function lockTaskShared(trx: Knex.Transaction, resource: CoManagedSharedResource) {
  const owner = tenantDb(trx, resource.tenant);
  const row = await owner.table('project_tasks').where('task_id', resource.id).first('task_name', 'due_date', 'project_status_mapping_id', 'updated_at');
  if (!row) throw new CoManagedSharedWorkError();
  return row;
}
/** The MSP participation row; no row (or an inactive one) means the task is not in this technician's scope. */
async function referenceRow(context: CoManagedSharedWorkContext, lock: boolean) {
  const query = tenantDb(context.trx, context.actor.tenant).table('co_managed_project_task_references')
    .where({ customer_tenant: context.resource.tenant, relationship_id: context.resource.relationshipId, task_id: context.resource.id, active: true });
  if (lock) query.forUpdate();
  const reference = await query.first();
  if (!reference) throw new CoManagedSharedWorkError();
  return reference;
}

/**
 * Edit a customer's shared task. One transaction: L2 admission (grant, staff role, home RBAC, lifecycle)
 * -> lock the MSP reference row -> lock the customer task row -> two-sided guard -> write through the
 * base model -> bump `revision`. Any guard failure throws before the write, and the transaction
 * rolls back, so a stale write never lands.
 */
export async function editCoManagedProjectTask(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedTaskEditRequest, writeTask: CoManagedTaskWriter): Promise<CoManagedTaskEditReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource), request = snapshotRequest(input);
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, resource, 'update', async context => {
    for (const field of Object.keys(request.patch) as CoManagedTaskEditField[]) if (fieldHidden(context.redactedFields, field)) throw new CoManagedSharedWorkError();
    const { trx } = context, home = tenantDb(trx, actor.tenant), customer = tenantDb(trx, resource.tenant);
    const reference = await referenceRow(context, true);
    // Replay: the reference lock above serialises concurrent retries; a known operation id returns its original receipt.
    const requestHash = coManagedRequestHash('task_edit', resource, { expectedRevision: request.expectedRevision, expectedTaskUpdatedAt: request.expectedTaskUpdatedAt, patch: request.patch });
    if (request.operationId) {
      const replay = await findCoManagedTaskReplay<CoManagedTaskEditReceipt>(context, request.operationId, requestHash);
      if (replay) return replay;
    }
    const task = await lockTask(trx, resource);
    const fresh = (): CoManagedTaskSnapshot => ({ revision: reference.revision, taskUpdatedAt: iso(task.updated_at), values: values(task, context.redactedFields), assignee: assigneeOf(reference) });
    // Side one: shared-command concurrency. Side two: the customer changed the task since it was loaded.
    if (reference.revision !== request.expectedRevision) throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT', 'revision', fresh());
    if (iso(task.updated_at) !== request.expectedTaskUpdatedAt) throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT', 'customer_drift', fresh());
    if (request.patch.project_status_mapping_id) {
      // The status must be a mapping of this task's own project (phase-level or project-level).
      const mapping = await customer.table('project_status_mappings').where({ project_status_mapping_id: request.patch.project_status_mapping_id, project_id: task.project_id })
        .where(scope => scope.whereNull('phase_id').orWhere('phase_id', task.phase_id)).forShare().first('project_status_mapping_id');
      if (!mapping) throw new CoManagedTaskEditError('INVALID_TASK_EDIT');
    }
    await context.assertCurrent();
    await writeTask(trx, resource.tenant, resource.id, request.patch);
    const written = await lockTaskShared(trx, resource);
    const next = reference.revision + 1;
    const patchedName = request.patch.task_name;
    // write-admission: exempt — MSP-owned participation reference (no customer data), written under the reference-row lock inside L2 admission (withCoManagedSharedWork 'update')
    await home.table('co_managed_project_task_references').where({ reference_id: reference.reference_id })
      .update({ revision: next, updated_at: trx.fn.now(), organization_name: await readCoManagedCustomerOrganizationName(trx, resource.tenant, context.redactedFields), ...(patchedName ? { task_name: patchedName } : {}) });
    const receipt = { revision: next, taskUpdatedAt: iso(written.updated_at) };
    const changes = Object.fromEntries(Object.keys(request.patch).map(field => [field, { from: (task as any)[field] instanceof Date ? (task as any)[field].toISOString() : ((task as any)[field] ?? null), to: request.patch[field as CoManagedTaskEditField] ?? null }]));
    await recordCoManagedTaskAudit(context, { operation: 'co_managed_project_task_update', operationId: request.operationId ?? randomUUID(), requestHash, changes, receipt });
    await context.assertCurrent();
    return receipt;
  });
}

export interface CoManagedProjectTaskStatusOption { statusMappingId: string; name: string }

/**
 * The statuses a technician may move a shared task to: the mappings of the task's own project that are
 * project-level or belong to the task's phase (the same scope `editCoManagedProjectTask` validates against).
 * Display names only; the mapping id is the value the editor submits.
 */
export async function listCoManagedProjectTaskStatusOptions(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource): Promise<CoManagedProjectTaskStatusOption[]> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = taskResource(inputResource);
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, resource, 'read', async context => {
    if (fieldHidden(context.redactedFields, 'project_status_mapping_id')) return [];
    const customer = tenantDb(context.trx, resource.tenant);
    const taskQuery = customer.table('project_tasks as task').where('task.task_id', resource.id);
    customer.tenantJoin(taskQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    const task = await taskQuery.first('task.phase_id', 'phase.project_id');
    if (!task) throw new CoManagedSharedWorkError();
    const query = customer.table('project_status_mappings as psm')
      .where('psm.project_id', task.project_id)
      .where(scope => scope.whereNull('psm.phase_id').orWhere('psm.phase_id', task.phase_id));
    customer.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
    customer.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
    const rows = await query.orderBy('psm.display_order')
      .select('psm.project_status_mapping_id', context.trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as name')) as Array<{ project_status_mapping_id: string; name: string | null }>;
    return rows.filter(row => row.name).map(row => ({ statusMappingId: row.project_status_mapping_id, name: row.name as string }));
  });
}

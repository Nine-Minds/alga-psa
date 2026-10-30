import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { recordCoManagedWorkAudit } from './sharedWorkAudit';
import { CoManagedSharedWorkError, snapshotCoManagedSessionActor, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedProjectWorkServed } from './projectTaskGate';

export const CO_MANAGED_TASK_AUDIT_OPERATIONS = ['co_managed_project_task_update', 'co_managed_project_task_assignment'] as const;
export type CoManagedTaskAuditOperation = typeof CO_MANAGED_TASK_AUDIT_OPERATIONS[number];

/** Stable digest of a command's meaning. Same operation id + same hash = replay; same id + other hash = misuse. */
export function coManagedRequestHash(kind: string, resource: CoManagedSharedResource, body: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical({ kind, tenant: resource.tenant, relationshipId: resource.relationshipId, id: resource.id, body }))).digest('hex');
}

/**
 * Idempotency in app code only (no triggers, PLAN §3): every shared command writes an audit entry in the customer
 * tenant carrying its operation id, request hash and receipt. A repeat of the same operation id returns that
 * receipt without writing; the same id with a different hash is refused. Called inside the admitted transaction,
 * after the reference row lock, so two concurrent replays serialise on the lock and the second one sees the entry.
 */
export async function findCoManagedTaskReplay<Receipt>(context: CoManagedSharedWorkContext, operationId: string, requestHash: string): Promise<Receipt | null> {
  const row = await tenantDb(context.trx, context.resource.tenant).table('audit_logs')
    .where({ table_name: 'project_tasks', record_id: context.resource.id }).whereIn('operation', [...CO_MANAGED_TASK_AUDIT_OPERATIONS])
    .whereRaw("details->>'operation_id' = ?", [operationId]).first('details');
  if (!row) return null;
  const details = row.details ?? {};
  if (details.actor_tenant !== context.actor.tenant || details.actor_user_id !== context.actor.userId || details.request_hash !== requestHash) throw new CoManagedSharedWorkError();
  return details.receipt as Receipt;
}

export async function recordCoManagedTaskAudit(context: CoManagedSharedWorkContext, input: {
  operation: CoManagedTaskAuditOperation; operationId: string; requestHash: string; changes: Record<string, unknown>; receipt: unknown;
}) {
  // audit_logs has a BEFORE INSERT trigger that files the row under app.current_tenant. The request runs in the sponsor's
  // tenant context, so pin the GUC to the customer (transaction-local) for the insert, then restore it. Same technique as
  // delegatedAdministration.ts.
  await context.trx.raw('select set_config(?, ?, true)', ['app.current_tenant', context.resource.tenant]);
  try {
    await recordCoManagedWorkAudit(context, { operation: input.operation, operationId: input.operationId, changes: input.changes,
      details: { request_hash: input.requestHash, receipt: input.receipt } });
  } finally {
    await context.trx.raw('select set_config(?, ?, true)', ['app.current_tenant', context.actor.tenant]);
  }
}

export interface CoManagedTaskHistoryEntry {
  auditId: string; at: string; operation: CoManagedTaskAuditOperation; authorName: string; organizationName: string; changes: Record<string, unknown>;
}

/** Newest-first change history for one shared task: qualified (name + organisation) authors, redacted fields removed. */
export async function listCoManagedProjectTaskHistory(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  options: { limit?: number } = {}): Promise<CoManagedTaskHistoryEntry[]> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputResource || inputResource.kind !== 'project_task' || ![inputResource.tenant, inputResource.id, inputResource.relationshipId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'project_task', tenant: inputResource.tenant.toLowerCase(), id: inputResource.id.toLowerCase(), relationshipId: inputResource.relationshipId.toLowerCase() };
  const limit = Number.isInteger(options.limit) && options.limit! > 0 ? Math.min(options.limit!, 100) : 50;
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, resource, 'read', async context => {
    const rows = await tenantDb(context.trx, resource.tenant).table('audit_logs')
      .where({ table_name: 'project_tasks', record_id: resource.id }).whereIn('operation', [...CO_MANAGED_TASK_AUDIT_OPERATIONS])
      .whereRaw("details->>'relationship_id' = ?", [resource.relationshipId]).orderBy('timestamp', 'desc').orderBy('audit_id').limit(limit)
      .select('audit_id', 'timestamp', 'operation', 'changed_data', 'details');
    return rows.map((row: any) => {
      const changes = Object.fromEntries(Object.entries(row.changed_data ?? {}).filter(([field]) =>
        !isCoManagedReadFieldHidden(context.redactedFields, [field, `values.${field}`, `project_tasks.${field}`])).map(([field, change]) =>
        // The stored audit row keeps MSP user/team ids; the history shown to the customer carries display names only.
        field === 'msp_assignee' && change && typeof change === 'object'
          ? [field, { kind: (change as any).kind, name: (change as any).name }] : [field, change]));
      return { auditId: row.audit_id, at: new Date(row.timestamp).toISOString(), operation: row.operation, authorName: row.details?.actor_display_name ?? '',
        organizationName: row.details?.actor_organization_name ?? '', changes };
    });
  });
}

import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { ensureCoManagedActorReference } from './actorReferences';

/** Called only inside an admitted work writer; retain qualified immutable
 * attribution with the canonical owner's explicit audit tenant. */
export async function recordCoManagedWorkAudit(context: CoManagedSharedWorkContext, input: {
  operation: 'co_managed_project_task_update' | 'co_managed_project_task_assignment' | 'co_managed_ticket_assignment'; operationId: string;
  changes: Record<string, unknown>; details?: Record<string, unknown>; actorReferenceId?: string | null;
}) {
  if (context.action !== 'update' || !['project_task', 'ticket'].includes(context.resource.kind) || !context.trx.isTransaction) throw new CoManagedSharedWorkError();
  const owner = tenantDb(context.trx, context.resource.tenant), foreign = context.actor.tenant !== context.resource.tenant;
  const referenceId = foreign ? (input.actorReferenceId ?? await ensureCoManagedActorReference(context)) : null;
  const reference = referenceId ? await owner.table('collaboration_actor_references').where({ actor_reference_id: referenceId,
    actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId }).forShare().first('display_name', 'organization_name') : null;
  if (foreign && !reference) throw new CoManagedSharedWorkError();
  const user = foreign ? null : await tenantDb(context.trx, context.actor.tenant).table('users').where('user_id', context.actor.userId)
    .forShare().first('first_name', 'last_name', 'email');
  const organization = foreign ? null : await tenantDb(context.trx, context.actor.tenant).table('tenants').forShare().first('client_name');
  const name = reference?.display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || context.actor.userId);
  await owner.table('audit_logs').insert({ audit_id: randomUUID(), tenant: context.resource.tenant, table_name: context.resource.kind === 'ticket' ? 'tickets' : 'project_tasks', record_id: context.resource.id,
    operation: input.operation, changed_data: input.changes, user_id: foreign ? null : context.actor.userId, timestamp: context.trx.raw('clock_timestamp()'),
    details: { ...input.details, actor_reference_id: referenceId, actor_display_name: name, actor_organization_name: reference?.organization_name ?? organization?.client_name,
      actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId, relationship_id: context.resource.relationshipId, operation_id: input.operationId } });
}

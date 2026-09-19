import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { collaborationActorReferenceSchema, type CollaborationActorReference } from '@alga-psa/event-schemas/collaboration';

/** Internal context supplied by an admitted shared-work command, never action input. */
export interface TicketMutationCollaborationContext {
  actorReferenceId: string;
  /** Recheck session/deadline after mutation locks; the caller retains policy locks. */
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}

/** Attribution only. The caller must already authorize the customer-owned ticket. */
export async function resolveTicketMutationCollaborator(trx: Knex.Transaction, tenant: string,
  user: IUserWithRoles, context: TicketMutationCollaborationContext): Promise<CollaborationActorReference> {
  if (!trx?.isTransaction || !context || typeof context.assertWriteAuthority !== 'function' || tenant === user.tenant) {
    throw new Error('Invalid collaboration mutation context');
  }
  // Do not let a reference to another source user confer that user's identity.
  const row = await tenantDb(trx, tenant).table('collaboration_actor_references')
    .where({ actor_reference_id: context.actorReferenceId, actor_tenant: user.tenant, actor_user_id: user.user_id }).forShare().first();
  if (!row) throw new Error('Collaboration actor reference not found');
  return collaborationActorReferenceSchema.parse({ ownerTenantId: tenant, referenceId: row.actor_reference_id,
    tenantId: row.actor_tenant, userId: row.actor_user_id, displayName: row.display_name, organizationName: row.organization_name });
}

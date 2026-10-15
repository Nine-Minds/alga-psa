import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, assertCoManagedSessionUnexpired, isCoManagedUuid } from './sharedWorkIdentity';

/** Called inside an admitted shared-work command. This is attribution storage,
 * not an authorization adapter: callers must retain the shared-work boundary.
 * The owner-local reference is not a user and cannot sign in or consume a seat. */
export async function ensureCoManagedActorReference(context: CoManagedSharedWorkContext): Promise<string> {
  const { trx } = context;
  const ownerTenant = context.resource.tenant, actor = { ...context.actor };
  if (!trx?.isTransaction || context.action !== 'update' || ownerTenant === actor.tenant ||
      ![ownerTenant, actor.tenant, actor.userId, context.sessionId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const home = tenantDb(trx, actor.tenant);
  const user = await home.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false }).forShare()
    .first('first_name', 'last_name', 'email');
  const organization = await home.table('tenants').forShare().first('client_name');
  if (!user || !organization) throw new CoManagedSharedWorkError();
  const displayName = [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(' ') || user.email || actor.userId;
  await assertCoManagedSessionUnexpired(trx, { ...actor, kind: 'session', sessionId: context.sessionId });
  await assertCoManagedOperationalWrite(trx, ownerTenant);
  // Citus rejects non-IMMUTABLE functions in the DO UPDATE SET clause of an upsert on a
  // distributed table, so `trx.fn.now()` here fails at runtime. Bind the instant from Node.
  const now = new Date().toISOString();
  const organizationName = organization.client_name || actor.tenant;
  const [reference] = await tenantDb(trx, ownerTenant).table('collaboration_actor_references').insert({
    tenant: ownerTenant, actor_reference_id: randomUUID(), actor_tenant: actor.tenant, actor_user_id: actor.userId,
    display_name: displayName, organization_name: organizationName,
  }).onConflict(['tenant', 'actor_tenant', 'actor_user_id']).merge({
    display_name: displayName, organization_name: organizationName, updated_at: now,
  }).returning('actor_reference_id');
  return reference.actor_reference_id;
}

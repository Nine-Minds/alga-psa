'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedPolicyError, readCoManagedSlaPolicyScreen, replaceCoManagedSlaPriorityMappings,
  type CoManagedSlaPriorityMapping } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { admitCoManagedSponsor } from '../co-managed/admitSponsor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';

type Failure = { ok: false; errorCode: 'FORBIDDEN' | 'PERMISSION_DENIED' | 'INVALID_POLICY' | 'POLICY_CHANGED' | 'RESOURCE_NOT_FOUND' };
const refusal = (error: unknown): Failure => {
  if (error instanceof CoManagedPolicyError) return { ok: false, errorCode: error.code };
  throw error;
};

// SLA priority mapping is the MSP's own configuration, so it is a sponsor-only surface: the capability
// gate is `admits` (flag AND entitlement), the first statement after the session establishes the tenant.
async function setup(user: { user_id: string; user_type?: string }, tenant: string, relationshipId: string) {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  const { knex } = await createTenantKnex(tenant);
  const target = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
  if (target.side !== 'sponsor') throw new CoManagedPolicyError('FORBIDDEN');
  await admitCoManagedSponsor(tenant, knex);
  const actor = await coManagedBrowserActor(user, tenant);
  return { knex, actor: { tenant: actor.tenant, userId: actor.userId }, target };
}

export const getCoManagedSlaPolicyAction = withAuth(async (user, { tenant }, relationshipId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, screen: await readCoManagedSlaPolicyScreen(knex, actor, target) };
  } catch (error) { return refusal(error); }
});

export const saveCoManagedSlaPriorityMappingsAction = withAuth(async (user, { tenant }, relationshipId: string,
  mappings: CoManagedSlaPriorityMapping[]) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    await replaceCoManagedSlaPriorityMappings(knex, actor, target, mappings);
    return { ok: true as const };
  } catch (error) { return refusal(error); }
});

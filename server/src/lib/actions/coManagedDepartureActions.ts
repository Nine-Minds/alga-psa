'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { departCoManagedRelationship, getCoManagedDepartureScreen, CoManagedSharedWorkError,
  type CoManagedDepartureRequest, type CoManagedDepartureQualifiedTarget } from '@alga-psa/co-managed';
import { resolveCoManagedManagementTarget, type CoManagedManagementSelector } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { coManagedSponsorEntry } from '../co-managed/sponsorWorkspaceDirectory';

/** A legacy provisioning operation ID is a compatibility selector; an explicit
 * customer-home or sponsor-client selector resolves the same qualified target. */
async function resolveQualifiedTarget(knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  actor: Awaited<ReturnType<typeof coManagedBrowserActor>>, input?: string | CoManagedManagementSelector) {
  if (input === undefined || typeof input === 'string') return undefined;
  const resolution = await resolveCoManagedManagementTarget(knex, actor, input);
  if (resolution.kind !== 'resolved') throw new CoManagedSharedWorkError();
  const target: CoManagedDepartureQualifiedTarget = { side: resolution.target.side,
    customerTenant: resolution.target.customerTenant, relationshipId: resolution.target.relationshipId,
    sponsorTenant: resolution.target.side === 'customer' ? resolution.target.otherTenant : actor.tenant };
  return target;
}

export const getCoManagedDepartureScreenAction = withAuth(async (user, { tenant }, input?: string | CoManagedManagementSelector) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  // A sponsor that named no workspace has no customer home to depart from.
  // Offer the same choice the policy and SLA screens offer rather than throwing.
  let qualified = input;
  if (qualified === undefined) {
    const entry = await coManagedSponsorEntry(knex, actor);
    if (entry?.side === 'directory') return entry;
    if (entry?.side === 'operation') qualified = entry.operationId;
  }
  return getCoManagedDepartureScreen(knex, actor, typeof qualified === 'string' ? qualified : undefined,
    await resolveQualifiedTarget(knex, actor, qualified));
});

export const departCoManagedRelationshipAction = withAuth(async (user, { tenant }, input: CoManagedDepartureRequest & { selector?: CoManagedManagementSelector }) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { selector, ...request } = input ?? {};
  return departCoManagedRelationship(knex, actor, request as CoManagedDepartureRequest, await resolveQualifiedTarget(knex, actor, selector));
});

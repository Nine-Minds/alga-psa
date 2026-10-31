'use server';

import { randomUUID } from 'node:crypto';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { invalidateWriteAdmission } from '@alga-psa/db/writeAdmission';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { invalidateCoManagedAwaitingAcceptance } from '@alga-psa/licensing';
import {
  CoManagedClosureError, departCoManagedRelationship, getCoManagedDepartureScreen, isCoManagedSharedWorkError, isCoManagedUuid,
  resolveCoManagedManagementTarget, type CoManagedDepartureQualifiedTarget, type CoManagedDepartureReview,
} from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

// Departure is authorized by L1a's existing relationship authority (`co_management:manage`, rechecked
// inside the closure transaction); there is no departure-specific permission. Both actions gate on
// `serves`, never `admits`: a lapsed or entitlement-less relationship must still be endable and reviewable.

/** The browser names the MSP-side client (never a foreign tenant). A customer workspace names nothing. */
export interface CoManagedDepartureTargetInput { clientId?: string; relationshipId?: string }

export type CoManagedDepartureResult =
  | { ok: true; review: CoManagedDepartureReview }
  | { ok: false; reason: 'denied' | 'not_found' };

export type CoManagedDepartResult =
  | { ok: true; releasedSeats: number; closedAt: string; replayed: boolean }
  | { ok: false; reason: 'denied' | 'changed' | 'already_closed' | 'invalid' };

// Not `async`/`await`: helpers are called only after the capability adapter, and keeping them promise-chained
// keeps the adapter-before-database-work contract checkable on the exported actions alone.
function qualifiedFor(knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'], actor: Awaited<ReturnType<typeof coManagedBrowserActor>>,
  input: CoManagedDepartureTargetInput): Promise<CoManagedDepartureQualifiedTarget | undefined | null> {
  if (!input.clientId) return Promise.resolve(undefined);
  if (!isCoManagedUuid(input.clientId)) return Promise.resolve(null);
  return resolveCoManagedManagementTarget(knex, actor,
    { kind: 'sponsor-client', clientId: input.clientId, relationshipId: input.relationshipId }).then(resolution =>
    resolution.kind !== 'resolved' ? null
      : { side: 'sponsor' as const, customerTenant: resolution.target.customerTenant, relationshipId: resolution.target.relationshipId, sponsorTenant: actor.tenant });
}

/** Pre-flight review. Outstanding handoffs and seats to release are advisory: they warn, never block. */
export const getCoManagedDeparture = withAuth(async (user, { tenant }, input: CoManagedDepartureTargetInput = {}): Promise<CoManagedDepartureResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const qualified = await qualifiedFor(knex, actor, input);
    if (qualified === null) return { ok: false, reason: 'not_found' };
    return { ok: true, review: await getCoManagedDepartureScreen(knex, actor, undefined, qualified) };
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return { ok: false, reason: 'denied' };
    throw error;
  }
});

/** End the relationship. `operationId` is minted by the caller once per confirmation so a retry replays. */
export const departFromCoManagedRelationship = withAuth(async (user, { tenant },
  input: CoManagedDepartureTargetInput & { relationshipId: string; expectedRevision: number; operationId?: string }): Promise<CoManagedDepartResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const qualified = await qualifiedFor(knex, actor, input);
    if (qualified === null) return { ok: false, reason: 'denied' };
    const operationId = input.operationId ?? randomUUID();
    const receipt = await departCoManagedRelationship(knex, actor,
      { operationId, expectedRevision: input.expectedRevision, relationshipId: input.relationshipId }, qualified);
    // Lifecycle transition: drop this process's cached admission and awaiting-acceptance decisions so the
    // ended workspace is read-only immediately. Other processes converge within the resolver's short TTL.
    invalidateWriteAdmission(receipt.customerTenant);
    invalidateCoManagedAwaitingAcceptance(receipt.customerTenant);
    return { ok: true, releasedSeats: receipt.releasedSeats, closedAt: receipt.closedAt };
  } catch (error) {
    if (error instanceof CoManagedClosureError) {
      return { ok: false, reason: error.code === 'CLOSURE_CHANGED' ? 'changed' : error.code === 'RELATIONSHIP_CLOSED' ? 'already_closed' : 'invalid' };
    }
    if (isCoManagedSharedWorkError(error)) return { ok: false, reason: 'denied' };
    throw error;
  }
});

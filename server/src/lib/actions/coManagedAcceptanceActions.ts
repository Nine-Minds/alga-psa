'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, UserPreferences } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { acceptCoManagedRelationship, declineCoManagedRelationship, getCoManagedAcceptanceState } from '@alga-psa/co-managed';
import { startCoManagedProvisioningCleanupWorkflow } from '@enterprise/lib/co-managed/workflowClient';

interface AcceptanceInput { relationshipId: string; revision: number; scopeFingerprint: string }

// Read only the authenticated customer's own preference, after consent. A read
// failure must not silently turn a required password change into access.
export const getCoManagedPasswordStatus = withAuth(async (user, { tenant }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const preference = await UserPreferences.get(knex, user.user_id, 'has_reset_password');
  return { hasResetPassword: preference ? preference.setting_value === true : true };
});

// These run before acceptance, so they opt out of the awaiting-acceptance guard.
// They gate on `serves` (durable participation), not `admits`: a customer who is
// already a party to a relationship must still be able to answer it.
export const getCustomerCoManagedAcceptance = withAuth(async (user, { tenant }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedAcceptanceState(knex, { tenant, userId: user.user_id });
}, { allowBeforeCoManagedAcceptance: true });

export const acceptCustomerCoManagedRelationship = withAuth(async (user, { tenant }, input: AcceptanceInput) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  await acceptCoManagedRelationship(knex, { tenant, userId: user.user_id }, input);
}, { allowBeforeCoManagedAcceptance: true });

export const declineCustomerCoManagedRelationship = withAuth(async (user, { tenant }, input: AcceptanceInput) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const declined = await declineCoManagedRelationship(knex, { tenant, userId: user.user_id }, input);
  // The decline is durable before the workflow starts; a missing Temporal only
  // delays cleanup, which the sponsor can retry from the operation.
  const scheduled = await startCoManagedProvisioningCleanupWorkflow({
    sponsorTenant: declined.sponsorTenant, operationId: declined.operationId });
  return { declined: true as const, enqueued: scheduled.enqueued };
}, { allowBeforeCoManagedAcceptance: true });

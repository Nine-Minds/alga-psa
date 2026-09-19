'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '@alga-psa/co-managed';

export const getCustomerCoManagedAcceptance = withAuth(async (user, { tenant }) => {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedAcceptanceState(knex, { tenant, userId: user.user_id });
});

export const acceptCustomerCoManagedRelationship = withAuth(async (user, { tenant }, input: {
  relationshipId: string; revision: number; scopeFingerprint: string;
}) => {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  await acceptCoManagedRelationship(knex, { tenant, userId: user.user_id }, input);
});

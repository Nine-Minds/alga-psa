'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { departCoManagedRelationship, getCoManagedDepartureScreen, type CoManagedDepartureRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedDepartureScreenAction = withAuth(async (user, { tenant }, provisioningOperationId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedDepartureScreen(knex, actor, provisioningOperationId);
});

export const departCoManagedRelationshipAction = withAuth(async (user, { tenant }, input: CoManagedDepartureRequest) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return departCoManagedRelationship(knex, actor, input);
});

'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedEffortTotals, CoManagedSharedWorkError, registerCoManagedTimeWorkReference, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const registerSharedTimeWorkAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return registerCoManagedTimeWorkReference(knex, actor, resource);
});

export type CoManagedEffortTarget = { kind: 'shared'; resource: CoManagedSharedResource } | { kind: 'local_project'; projectId: string };

export const getSharedEffortTotalsAction = withAuth(async (user, { tenant }, target: CoManagedEffortTarget) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    if (target?.kind === 'shared') return getCoManagedEffortTotals(trx, actor, target.resource);
    if (target?.kind !== 'local_project') throw new CoManagedSharedWorkError();
    const relationship = await tenantDb(trx, tenant).table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').first('relationship_id');
    if (!relationship) throw new CoManagedSharedWorkError();
    return getCoManagedEffortTotals(trx, actor, { tenant, relationshipId: relationship.relationship_id, kind: 'project', id: target.projectId });
  });
});

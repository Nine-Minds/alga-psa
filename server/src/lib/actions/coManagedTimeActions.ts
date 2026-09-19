'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedEffortTotals, CoManagedSharedWorkError, registerCoManagedTimeWorkReference, getCoManagedTimeBillingProfile,
  setCoManagedTimeBillingProfile, type CoManagedTimeBillingProfileChange, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const registerSharedTimeWorkAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return registerCoManagedTimeWorkReference(knex, actor, resource);
});

export const getSharedTimeBillingProfileAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant);
  if (resource?.tenant === actor.tenant) return null;
  const { knex } = await createTenantKnex(tenant);
  try { return await getCoManagedTimeBillingProfile(knex, actor, resource); }
  catch (error) { if (error instanceof CoManagedSharedWorkError) return null; throw error; }
});

export const setSharedTimeBillingProfileAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTimeBillingProfileChange) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return setCoManagedTimeBillingProfile(knex, actor, resource, request);
});

export type CoManagedEffortTarget = { kind: 'shared'; resource: CoManagedSharedResource }
  | { kind: 'local_project'; projectId: string } | { kind: 'local_task'; taskId: string };

export const getSharedEffortTotalsAction = withAuth(async (user, { tenant }, target: CoManagedEffortTarget) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    if (target?.kind === 'shared') return getCoManagedEffortTotals(trx, actor, target.resource);
    if (target?.kind !== 'local_project' && target?.kind !== 'local_task') throw new CoManagedSharedWorkError();
    // Customer-local reads are retained history: a terminated relationship still
    // resolves the resource identity so the customer keeps its own effort view
    // after departure. Prefer the live relationship, else the most recently
    // ended one; the local-work boundary and the effort query decide what a
    // non-live relationship may still disclose (customer-owned effort only).
    const relationship = await tenantDb(trx, tenant).table('co_management_relationships')
      .orderByRaw(`(state = 'active' and ended_at is null) desc`).orderBy('ended_at', 'desc')
      .first('relationship_id');
    if (!relationship) throw new CoManagedSharedWorkError();
    return getCoManagedEffortTotals(trx, actor, { tenant, relationshipId: relationship.relationship_id,
      kind: target.kind === 'local_project' ? 'project' : 'project_task', id: target.kind === 'local_project' ? target.projectId : target.taskId });
  });
});

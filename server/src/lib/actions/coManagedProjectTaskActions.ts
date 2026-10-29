'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import {
  assignCoManagedProjectTask, editCoManagedProjectTask, getCoManagedProjectTaskSnapshot, isCoManagedSharedWorkError,
  listCoManagedSharedProjects, listCoManagedSharedProjectTasks,
  type CoManagedTaskAssignmentRequest, type CoManagedTaskEditRequest,
} from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';
import { writeCoManagedSharedTask } from '../co-managed/editProjectTask';

// Every action gates on `serves` (flag + entitlement + kill switch) and derives the actor from the
// verified session. A denial in any access layer is `null` on reads.

async function sponsorTarget(knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'], tenant: string, relationshipId: string) {
  const target = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
  return target.side === 'sponsor' ? target : null;
}

export const listCoManagedSharedProjectsAction = withAuth(async (user, { tenant }, input: { relationshipId?: string; limit?: number; after?: { relationshipId: string; projectId: string } } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return listCoManagedSharedProjects(knex, actor, input ?? {});
});

export const listCoManagedSharedProjectTasksAction = withAuth(async (user, { tenant }, relationshipId: string, projectId: string, input: { limit?: number; afterTaskId?: string } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    const target = await sponsorTarget(knex, tenant, relationshipId);
    if (!target) return null;
    return await listCoManagedSharedProjectTasks(knex, actor, { customerTenant: target.customerTenant, relationshipId, projectId }, input ?? {});
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return null;
    throw error;
  }
});

export const getCoManagedProjectTaskSnapshotAction = withAuth(async (user, { tenant }, relationshipId: string, taskId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    const target = await sponsorTarget(knex, tenant, relationshipId);
    if (!target) return null;
    return await getCoManagedProjectTaskSnapshot(knex, actor, { kind: 'project_task', tenant: target.customerTenant, relationshipId, id: taskId });
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return null;
    throw error;
  }
});

export const editCoManagedProjectTaskAction = withAuth(async (user, { tenant }, relationshipId: string, taskId: string, input: CoManagedTaskEditRequest) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const target = await sponsorTarget(knex, tenant, relationshipId);
  if (!target) return { success: false as const, error: 'NOT_FOUND' };
  return { success: true as const, receipt: await editCoManagedProjectTask(knex, actor, { kind: 'project_task', tenant: target.customerTenant, relationshipId, id: taskId }, input, writeCoManagedSharedTask) };
});

export const assignCoManagedProjectTaskAction = withAuth(async (user, { tenant }, relationshipId: string, taskId: string, input: CoManagedTaskAssignmentRequest) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const target = await sponsorTarget(knex, tenant, relationshipId);
  if (!target) return { success: false as const, error: 'NOT_FOUND' };
  return { success: true as const, receipt: await assignCoManagedProjectTask(knex, actor, { kind: 'project_task', tenant: target.customerTenant, relationshipId, id: taskId }, input) };
});

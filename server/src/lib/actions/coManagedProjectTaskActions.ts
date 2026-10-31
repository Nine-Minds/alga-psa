'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import {
  assignCoManagedProjectTask, editCoManagedProjectTask, getCoManagedProjectTaskSnapshot, isCoManagedSharedWorkError,
  listCoManagedAssignedTasks, listCoManagedProjectTaskHistory, listCoManagedProjectTaskStatusOptions, listCoManagedSharedProjects, listCoManagedSharedProjectTasks, CoManagedTaskEditError,
  type CoManagedTaskAssignmentRequest, type CoManagedTaskEditRequest, type CoManagedTaskSnapshot,
} from '@alga-psa/co-managed';
import { searchSharedProjects } from '@alga-psa/search/projectSearchAccess';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { writeCoManagedSharedTask } from '../co-managed/editProjectTask';

// Gate: `serves` (PLAN §2: "keep serving existing state: reads ... a flag flip never strands a workspace").
// Editing or assigning an already-shared task continues existing work; nothing here provisions or starts a
// relationship (that is `admits`, owned by L1). The actor comes from the verified session, never the caller.
// The customer tenant in an address is only a locator: L2 admission re-checks the relationship and grant.

export type CoManagedTaskCommandResult<T> =
  | { success: true; receipt: T }
  | { success: false; error: 'CONFLICT'; reason: 'revision' | 'customer_drift' | undefined; snapshot: CoManagedTaskSnapshot | undefined }
  | { success: false; error: 'INVALID' }
  | { success: false; error: 'NOT_FOUND' };

/** Conflicts carry a fresh snapshot for the editor; validation and every access denial are opaque. */
function commandFailure(error: unknown): CoManagedTaskCommandResult<never> {
  if (error instanceof CoManagedTaskEditError) {
    return error.code === 'TASK_EDIT_CONFLICT' ? { success: false, error: 'CONFLICT', reason: error.reason, snapshot: error.snapshot } : { success: false, error: 'INVALID' };
  }
  if (isCoManagedSharedWorkError(error)) return { success: false, error: 'NOT_FOUND' };
  throw error;
}
async function denyAsNull<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch (error) { if (isCoManagedSharedWorkError(error)) return null; throw error; }
}
const taskResource = (customerTenant: string, relationshipId: string, id: string) => ({ kind: 'project_task' as const, tenant: customerTenant, relationshipId, id });

export const listCoManagedSharedProjectsAction = withAuth(async (user, { tenant }, input: { relationshipId?: string; limit?: number; after?: { relationshipId: string; projectId: string } } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return listCoManagedSharedProjects(knex, actor, input ?? {});
  });
});

export const listCoManagedAssignedTasksAction = withAuth(async (user, { tenant }, input: { assigned?: 'me' | 'my_teams' | 'any'; limit?: number; after?: { referenceId: string } } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return listCoManagedAssignedTasks(knex, actor, input ?? {});
  });
});

export const listCoManagedSharedProjectTasksAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, projectId: string, input: { limit?: number; afterTaskId?: string } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return listCoManagedSharedProjectTasks(knex, actor, { customerTenant, relationshipId, projectId }, input ?? {});
  });
});

export const getCoManagedProjectTaskSnapshotAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, taskId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return getCoManagedProjectTaskSnapshot(knex, actor, taskResource(customerTenant, relationshipId, taskId));
  });
});

export const listCoManagedProjectTaskHistoryAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, taskId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return listCoManagedProjectTaskHistory(knex, actor, taskResource(customerTenant, relationshipId, taskId));
  });
});

export const listCoManagedProjectTaskStatusOptionsAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, taskId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return listCoManagedProjectTaskStatusOptions(knex, actor, taskResource(customerTenant, relationshipId, taskId));
  });
});

export const editCoManagedProjectTaskAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, taskId: string, input: CoManagedTaskEditRequest): Promise<CoManagedTaskCommandResult<{ revision: number; taskUpdatedAt: string }>> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return { success: true, receipt: await editCoManagedProjectTask(knex, actor, taskResource(customerTenant, relationshipId, taskId), input, writeCoManagedSharedTask) };
  } catch (error) { return commandFailure(error); }
});

export const assignCoManagedProjectTaskAction = withAuth(async (user, { tenant }, customerTenant: string, relationshipId: string, taskId: string, input: CoManagedTaskAssignmentRequest): Promise<CoManagedTaskCommandResult<{ referenceId: string; revision: number; assigneeName: string }>> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return { success: true, receipt: await assignCoManagedProjectTask(knex, actor, taskResource(customerTenant, relationshipId, taskId), input) };
  } catch (error) { return commandFailure(error); }
});

/** Shared Tasks search for one relationship: results, typeahead strip and counts from the same admitted relation. */
export const searchCoManagedSharedProjectsAction = withAuth(async (user, { tenant }, relationshipId: string, input: { query: string; limit?: number }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return denyAsNull(async () => {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    const found = await searchSharedProjects(knex, actor, relationshipId, input);
    const row = (hit: typeof found.results[number]) => ({ type: hit.type, id: hit.id, title: hit.title, subtitle: hit.subtitle, url: hit.url });
    return { totalCount: found.totalCount, groups: found.groups, results: found.results.map(row), typeahead: found.typeahead.map(row) };
  });
});

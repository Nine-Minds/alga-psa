'use server';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedProjectTaskAssignment, listCoManagedProjectTaskAssignees, assignCoManagedProjectTask, CoManagedTaskAssignmentError, type CoManagedTaskAssignmentRequest, getCoManagedProjectTaskEditor, getCoManagedProjectTaskStatuses, listCoManagedProjectTaskHistory, listCoManagedProjectTasks, CoManagedTaskEditError, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTaskEditRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { editSharedProjectTask } from '../co-managed/editProjectTask';

export const getSharedProjectTaskEditorAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return getCoManagedProjectTaskEditor(knex, actor, resource);
});
export const getSharedProjectTaskStatusesAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, afterId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return getCoManagedProjectTaskStatuses(knex, actor, resource, afterId);
});
export const editSharedProjectTaskAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTaskEditRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
    return { ok: true as const, receipt: await editSharedProjectTask(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedTaskEditError) return { ok: false as const, code: error.code === 'TASK_EDIT_CONFLICT' ? 'conflict' : error.code === 'TASK_EDIT_OPERATION_CONFLICT' ? 'operationConflict' : 'invalid' };
    if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' };
    return { ok: false as const, code: 'unknownOutcome' };
  }
});
export const listSharedProjectTasksAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, afterId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return listCoManagedProjectTasks(knex, actor, resource, afterId);
});

export const listSharedProjectTaskHistoryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, beforeId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return listCoManagedProjectTaskHistory(knex, actor, resource, beforeId);
});

export const getSharedProjectTaskAssignmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return getCoManagedProjectTaskAssignment(knex, actor, resource);
});
export const listSharedProjectTaskAssigneesAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, kind: 'user' | 'team', afterId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
  return listCoManagedProjectTaskAssignees(knex, actor, resource, kind, afterId);
});
export const assignSharedProjectTaskAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTaskAssignmentRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex();
    return { ok: true as const, receipt: await assignCoManagedProjectTask(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedTaskAssignmentError) return { ok: false as const, code: error.code === 'TASK_ASSIGNMENT_CONFLICT' ? 'conflict' : error.code === 'TASK_ASSIGNMENT_OPERATION_CONFLICT' ? 'operationConflict' : 'invalid' };
    if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' };
    return { ok: false as const, code: 'unknownOutcome' };
  }
});

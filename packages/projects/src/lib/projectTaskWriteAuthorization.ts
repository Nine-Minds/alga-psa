import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  assertAssigneesInActorProjection,
  isResolverGovernedUser,
} from '@alga-psa/authorization/recordCreateAuthorization';
import type { IUser, IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';
import { createProjectReadAuthorizer } from './projectReadAuthorization';

/**
 * Task writes for a subject a built-in rule resolver governs (a co-managed seat technician working a shared project).
 * Every function here returns before it reads anything for every other user, so the MSP task paths pay nothing.
 */

/**
 * The coarse permission for a task write. Today's check is `project:update`, and it still decides for everyone who
 * holds it. A seat technician does not hold it (it would open the project's own edit actions); they hold
 * `project_task:update`, which counts here only while the kernel governs them, and the record-level decision
 * (`assertTaskWriteAllowedOnProject`) still has to allow the write.
 */
// LEVERAGE: friction task-write-permission-is-project-update — every task write checks `project:update` (the permission to edit the
// project itself) while the catalog has `project_task:update` for exactly this; a seat technician holds only the latter, so the check
// is bent to accept it for a governed subject. Moving task actions to `project_task:*` needs a migration of every role that holds
// `project:update` today, which would change the MSP surface.
export async function assertTaskWritePermission(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
): Promise<void> {
  if (await hasPermission(user, 'project', 'update', trx)) return;
  if (await hasPermission(user, 'project_task', 'update', trx) && await isResolverGovernedUser(trx, { tenant, user })) return;
  throw new Error('Permission denied: Cannot update project');
}

/**
 * The record-level WRITE decision on the task's project for a governed subject: the kernel's mutation path, which
 * evaluates the project's `update` rules (own client, shared with the arrangement) and the seat write admission gate
 * (a lapsed seat writes nothing). The task's project is the resource a task write is a write on. Ordinary users
 * keep the read decision their task actions have always made.
 */
// LEVERAGE: friction task-has-no-kernel-resource — the kernel has `project` and no task/phase resource, so task authority is the parent
// project's decision, resolved by hand in `resolveProjectIdForTask/Phase` here, in the task comment boundary and in time entries
// (`ClientPath.parent`). One resource-parent registry for task actions (not only polymorphic time/tag/document rows) would replace all three.
export async function assertTaskWriteAllowedOnProject(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string,
  /** The project read decision the caller already made (`assertProjectReadAllowedById`); decides `governed` for free. */
  read: { governed: boolean },
): Promise<boolean> {
  if (!read.governed) return false;
  const project = await ProjectModel.getById(trx, tenant, projectId);
  const authorize = await createProjectReadAuthorizer(trx, tenant, user, 'update');
  if (!project || !(await authorize(project))) throw new Error('Permission denied: Cannot read project');
  return true;
}

/**
 * The task fields a governed subject may change through the task edit: the work's status, who has it, its checklist.
 * Tags are listed too, to match the screen, though they are written through the tag actions (which hold their own
 * record-scope and visibility checks), never through this edit. Everything
 * else on the task (name, description, dates, phase, hours, service) is the MSP's to plan. The edit form submits the
 * whole task, so a field outside this list is refused only when its value differs from what is stored, and a closed
 * field (never sent to the subject) is refused whenever it is named.
 */
export const GOVERNED_TASK_WRITABLE_FIELDS: readonly string[] = Object.freeze([
  'project_status_mapping_id', 'assigned_to', 'checklist_items', 'tags',
]);

const comparable = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : text;
};

export function assertGovernedTaskFieldsWritable(
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
  closedFields: readonly string[],
): void {
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (closedFields.includes(field)) throw new Error('Permission denied: Cannot update project');
    if (GOVERNED_TASK_WRITABLE_FIELDS.includes(field)) continue;
    if (comparable(value) !== comparable(existing[field])) throw new Error('Permission denied: Cannot update project');
  }
}

/**
 * A governed actor may assign task work only to the technicians of their own client (themselves included), the
 * people the S14 projection lists as `client_technician`; anyone else is refused. Whether that person may take the
 * work is `assertHumanWorkAssignee`, which the callers also run.
 */
export async function assertTaskAssigneesInActorProjection(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  assigneeIds: ReadonlyArray<string | null | undefined>,
  read: { governed: boolean },
): Promise<void> {
  if (!read.governed) return;
  await assertAssigneesInActorProjection(trx, { tenant, user, assigneeIds, kinds: ['client_technician'] }, 'this task to that person');
}

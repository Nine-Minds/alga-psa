/**
 * Record-level project read authorization, shared by surfaces that take a
 * project id from the caller.
 *
 * The coarse `project:read` / `project:update` RBAC check says the user may
 * work with projects at all; it says nothing about *this* project. Bundle
 * narrowing can restrict a user to a subset of the tenant's projects, so any
 * action that accepts a projectId has to run the kernel decision for that
 * record too. This module is the one implementation: the project, task, staging,
 * import and export actions all decide through it.
 */

import type { Knex } from 'knex';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import {
  createProjectReadAuthorizer,
  toProjectAuthorizationRecord,
  type ProjectAuthorizationFields,
} from '@alga-psa/authorization/projectReadAuthorization';
import ProjectModel from '../models/project';

export {
  createProjectActionDecider,
  createProjectReadAuthorizer,
  createProjectReadDecider,
  toProjectAuthorizationRecord,
  type ProjectAuthorizationAction,
  type ProjectAuthorizationFields,
  type ProjectReadDecision,
} from '@alga-psa/authorization/projectReadAuthorization';

/**
 * Loads the project and throws unless the caller may read that record.
 * Returns the loaded project so callers do not have to fetch it twice.
 */
export async function assertProjectReadAllowed(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string,
  apiKeyId?: string | null
): Promise<IProject> {
  const project = await ProjectModel.getById(conn, tenant, projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const authorize = await createProjectReadAuthorizer(conn, tenant, user, 'read', apiKeyId);
  if (!(await authorize(project))) {
    throw new Error('Permission denied: Cannot read project');
  }

  return project;
}

/** The create gate for MSP project creation: the candidate project's client (and assignee) are judged by the read rules. */
export async function assertProjectCreateAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  candidate: ProjectAuthorizationFields,
): Promise<void> {
  await assertRecordCreateAllowed(trx, {
    tenant,
    user,
    resourceType: 'project',
    record: toProjectAuthorizationRecord({ ...candidate, project_id: null }),
  }, 'project');
}

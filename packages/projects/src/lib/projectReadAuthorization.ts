/** Record-level project authorization shared by project and task actions. */

import type { Knex } from 'knex';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import {
  createProjectActionDecider,
  toProjectAuthorizationRecord,
  type ProjectAuthorizationAction,
  type ProjectAuthorizationFields,
  type ProjectReadDecision,
} from '@alga-psa/authorization/projectRecordAuthorization';
export {
  createProjectActionDecider,
  toProjectAuthorizationRecord,
  type ProjectAuthorizationAction,
  type ProjectAuthorizationFields,
  type ProjectReadDecision,
} from '@alga-psa/authorization/projectRecordAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';

export async function createProjectReadDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  return createProjectActionDecider(conn, tenant, user, 'read');
}

export async function createProjectReadAuthorizer(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  action: ProjectAuthorizationAction = 'read',
): Promise<(project: ProjectAuthorizationFields) => Promise<boolean>> {
  const decide = await createProjectActionDecider(conn, tenant, user, action);
  return async project => (await decide(project)).allowed;
}

export async function assertProjectReadAllowed(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string,
): Promise<IProject> {
  const project = await ProjectModel.getById(conn, tenant, projectId);
  if (!project) throw new Error('Project not found');
  const authorize = await createProjectReadAuthorizer(conn, tenant, user);
  if (!(await authorize(project))) throw new Error('Permission denied: Cannot read project');
  return project;
}

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

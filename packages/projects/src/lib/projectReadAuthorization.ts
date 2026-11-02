import type { Knex } from 'knex';
import { type IProject, type IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';
import { createProjectReadAuthorizer } from '@alga-psa/authorization/projectReadAuthorization';

export {
  authorizeProjectsByIds,
  createProjectReadAuthorizer,
  createProjectReadDecider,
  type ProjectAuthorizationFields,
  type ProjectReadDecision,
} from '@alga-psa/authorization/projectReadAuthorization';

/** Loads the project and throws unless the caller may read that record. */
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

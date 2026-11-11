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
import ProjectModel from '../models/project';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
} from '@alga-psa/authorization/kernel';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { createBundleNarrowingProvider } from '@alga-psa/authorization/bundles/narrowingProvider';

export type ProjectAuthorizationFields = { project_id?: string | null; client_id?: string | null; assigned_to?: string | null };

function toProjectAuthorizationRecord(project: ProjectAuthorizationFields): AuthorizationRecord {
  const assignedUserIds =
    typeof project.assigned_to === 'string' && project.assigned_to.length > 0 ? [project.assigned_to] : [];

  return {
    id: project.project_id ?? null,
    ownerUserId: project.assigned_to ?? null,
    assignedUserIds,
    clientId: project.client_id ?? null,
  };
}

export interface ProjectReadDecision {
  allowed: boolean;
  /** Fields the reader may not see for this project (co-managed redactions); empty when nothing is hidden. */
  redactedFields: string[];
}

/**
 * The record-level project read decision for one user, reusable across many projects in one request
 * (subject and kernel are resolved once). Carries the kernel's redaction set with the verdict so a caller
 * that renders or forwards project data can mask it. A row without a project id is not allowed.
 */
export async function createProjectReadDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  action: 'read' | 'update' = 'read'
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  const requestCache = new RequestLocalAuthorizationCache();
  // A failed lookup propagates: a subject that cannot be resolved gets no decision, hence no access.
  const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: createBundleNarrowingProvider(conn),
    rbacEvaluator: async () => true,
  });

  return async (project: ProjectAuthorizationFields): Promise<ProjectReadDecision> => {
    const projectId = project.project_id;
    if (!projectId) {
      return { allowed: false, redactedFields: [] };
    }

    const decision = await authorizationKernel.authorizeResource({
      subject,
      resource: { type: 'project', action, id: projectId },
      record: toProjectAuthorizationRecord(project),
      requestCache,
      knex: conn,
    });

    return { allowed: decision.allowed, redactedFields: [...(decision.redactedFields ?? [])] };
  };
}

/**
 * The boolean form of `createProjectReadDecider`, for callers that only need allow/deny.
 * Returns false for a row without a project id.
 */
export async function createProjectReadAuthorizer(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  action: 'read' | 'update' = 'read'
): Promise<(project: ProjectAuthorizationFields) => Promise<boolean>> {
  const decide = await createProjectReadDecider(conn, tenant, user, action);
  return async (project) => (await decide(project)).allowed;
}

/**
 * Loads the project and throws unless the caller may read that record.
 * Returns the loaded project so callers do not have to fetch it twice.
 */
export async function assertProjectReadAllowed(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string
): Promise<IProject> {
  const project = await ProjectModel.getById(conn, tenant, projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const authorize = await createProjectReadAuthorizer(conn, tenant, user);
  if (!(await authorize(project))) {
    throw new Error('Permission denied: Cannot read project');
  }

  return project;
}

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
import { tenantDb } from '@alga-psa/db';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { createBundleNarrowingProvider } from '@alga-psa/authorization/bundles/narrowingProvider';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function extractRoleIdsFromUser(user: IUserWithRoles): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<AuthorizationSubject> {
  // A failed lookup propagates: a subject that cannot be resolved gets no decision, hence no access.
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    const roleRows = await tenantScopedTable(conn, 'user_roles', tenant)
      .where({ user_id: user.user_id })
      .select<{ role_id: string }[]>('role_id');
    roleIds = roleRows.map((row) => row.role_id);
  }

  const [teamRows, managedRows] = await Promise.all([
    tenantScopedTable(conn, 'team_members', tenant).where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id'),
    tenantScopedTable(conn, 'users', tenant).where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id'),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

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

export type ProjectAuthorizationAction = 'read' | 'update' | 'delete';

/** Subject, kernel and request cache for one user's project decisions, resolved once per request. */
async function createProjectAuthorizationContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
) {
  const subject = await resolveAuthorizationSubjectForUser(conn, tenant, user);
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: createBundleNarrowingProvider(conn),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();

  return (projectId: string, project: ProjectAuthorizationFields, action: ProjectAuthorizationAction) => ({
    authorizationKernel,
    evaluation: {
      subject,
      resource: { type: 'project', action, id: projectId },
      record: toProjectAuthorizationRecord(project),
      requestCache,
      knex: conn,
    },
  });
}

/**
 * The record-level project read decision for one user, reusable across many projects in one request
 * (subject and kernel are resolved once). Carries the kernel's redaction set with the verdict so a caller
 * that renders or forwards project data can mask it. A row without a project id is not allowed.
 */
export async function createProjectReadDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  const prepare = await createProjectAuthorizationContext(conn, tenant, user);

  return async (project: ProjectAuthorizationFields): Promise<ProjectReadDecision> => {
    const projectId = project.project_id;
    if (!projectId) {
      return { allowed: false, redactedFields: [] };
    }

    const { authorizationKernel, evaluation } = prepare(projectId, project, 'read');
    const decision = await authorizationKernel.authorizeResource(evaluation);

    return { allowed: decision.allowed, redactedFields: [...(decision.redactedFields ?? [])] };
  };
}

/**
 * The boolean form of the project record decision, for callers that only need allow/deny.
 * `update` and `delete` are decided by the kernel's mutation path, which refuses a project the user's
 * read rules do not allow before it evaluates the write rules. Returns false for a row without a project id.
 */
export async function createProjectReadAuthorizer(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  action: ProjectAuthorizationAction = 'read'
): Promise<(project: ProjectAuthorizationFields) => Promise<boolean>> {
  const prepare = await createProjectAuthorizationContext(conn, tenant, user);

  return async (project) => {
    const projectId = project.project_id;
    if (!projectId) {
      return false;
    }

    const { authorizationKernel, evaluation } = prepare(projectId, project, action);
    const decision = action === 'read'
      ? await authorizationKernel.authorizeResource(evaluation)
      : await authorizationKernel.authorizeMutation(evaluation);
    return decision.allowed;
  };
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

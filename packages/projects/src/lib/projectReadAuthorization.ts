/**
 * Record-level project read authorization, shared by surfaces that take a
 * project id from the caller.
 *
 * The coarse `project:read` / `project:update` RBAC check says the user may
 * work with projects at all; it says nothing about *this* project. Bundle
 * narrowing can restrict a user to a subset of the tenant's projects, so any
 * action that accepts a projectId has to run the kernel decision for that
 * record too. The task, phase and status actions each carry their own copy of
 * this helper; the import/export actions use this one.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

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
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(conn, 'user_roles', tenant)
        .where({ user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  const [teamRows, managedRows] = await Promise.all([
    tenantScopedTable(conn, 'team_members', tenant).where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    tenantScopedTable(conn, 'users', tenant).where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
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

function toProjectAuthorizationRecord(project: Partial<IProject>): AuthorizationRecord {
  const assignedUserIds =
    typeof project.assigned_to === 'string' && project.assigned_to.length > 0 ? [project.assigned_to] : [];

  return {
    id: project.project_id ?? null,
    ownerUserId: project.assigned_to ?? null,
    assignedUserIds,
    clientId: project.client_id ?? null,
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

  const subject = await resolveAuthorizationSubjectForUser(conn, tenant, user);
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(conn, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();

  const decision = await authorizationKernel.authorizeResource({
    subject,
    resource: { type: 'project', action: 'read', id: projectId },
    record: toProjectAuthorizationRecord(project),
    requestCache,
    knex: conn,
  });

  if (!decision.allowed) {
    throw new Error('Permission denied: Cannot read project');
  }

  return project;
}

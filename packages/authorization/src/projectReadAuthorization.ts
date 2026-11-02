import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';

export type ProjectAuthorizationFields = { project_id?: string | null; client_id?: string | null; assigned_to?: string | null };
export interface ProjectReadDecision { allowed: boolean; redactedFields: string[] }

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function roleIds(user: IUserWithRoles): string[] {
  return Array.isArray(user.roles) ? user.roles.map((role) => typeof role === 'string' ? role : role?.role_id ?? '').filter(Boolean) : [];
}

async function resolveSubject(conn: Knex | Knex.Transaction, tenant: string, user: IUserWithRoles): Promise<AuthorizationSubject> {
  let roles = roleIds(user);
  if (roles.length === 0) {
    try {
      roles = (await tenantScopedTable(conn, 'user_roles', tenant).where({ user_id: user.user_id }).select<{ role_id: string }[]>('role_id')).map(({ role_id }) => role_id);
    } catch { roles = []; }
  }
  const [teams, managed] = await Promise.all([
    tenantScopedTable(conn, 'team_members', tenant).where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    tenantScopedTable(conn, 'users', tenant).where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
  ]);
  return {
    tenant, userId: user.user_id, userType: user.user_type, roleIds: roles,
    teamIds: teams.map(({ team_id }) => team_id), managedUserIds: managed.map(({ user_id }) => user_id),
    clientId: user.clientId ?? null, portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function toAuthorizationRecord(project: ProjectAuthorizationFields): AuthorizationRecord {
  const assignedUserIds = typeof project.assigned_to === 'string' && project.assigned_to ? [project.assigned_to] : [];
  return { id: project.project_id ?? null, ownerUserId: project.assigned_to ?? null, assignedUserIds, clientId: project.client_id ?? null };
}

/** Resolve one request's project/read kernel and retain each record's effective redactions. */
export async function createProjectReadDecider(
  conn: Knex | Knex.Transaction, tenant: string, user: IUserWithRoles, action: 'read' | 'update' = 'read'
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  const subject = await resolveSubject(conn, tenant, user);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try { return await resolveBundleNarrowingRulesForEvaluation(conn, input); } catch { return []; }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();
  return async (project) => {
    if (!project.project_id) return { allowed: false, redactedFields: [] };
    const decision = await kernel.authorizeResource({
      subject, resource: { type: 'project', action, id: project.project_id },
      record: toAuthorizationRecord(project), requestCache, knex: conn,
    });
    return { allowed: decision.allowed, redactedFields: [...(decision.redactedFields ?? [])] };
  };
}

export async function createProjectReadAuthorizer(
  conn: Knex | Knex.Transaction, tenant: string, user: IUserWithRoles, action: 'read' | 'update' = 'read'
): Promise<(project: ProjectAuthorizationFields) => Promise<boolean>> {
  const decide = await createProjectReadDecider(conn, tenant, user, action);
  return async (project) => (await decide(project)).allowed;
}

/** Project IDs from callers are resolved back to tenant-scoped identity rows before authorization. */
export async function authorizeProjectsByIds(
  conn: Knex | Knex.Transaction, tenant: string, user: IUserWithRoles, projectIds: string[], action: 'read' | 'update' = 'read'
): Promise<Array<{ project: ProjectAuthorizationFields; allowed: boolean; redactedFields: string[] }>> {
  const ids = [...new Set(projectIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return [];
  const identities = await tenantScopedTable(conn, 'projects', tenant).whereIn('project_id', ids)
    .select<Array<ProjectAuthorizationFields>>('project_id', 'assigned_to', 'client_id');
  const decide = await createProjectReadDecider(conn, tenant, user, action);
  return Promise.all(identities.map(async (project) => ({ project, ...(await decide(project)) })));
}

import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
} from './kernel';
import { resolveAuthorizationSubject } from './subject';
import { resolveAppliedBuiltinResolvers } from './kernel/builtinRuleResolvers';
import { createBundleNarrowingProvider } from './bundles/narrowingProvider';

export type ProjectAuthorizationFields = { project_id?: string | null; client_id?: string | null; assigned_to?: string | null };

export function toProjectAuthorizationRecord(project: ProjectAuthorizationFields): AuthorizationRecord {
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
  /**
   * A built-in rule resolver governs the reader (a co-managed seat technician). Read from the subject this decision
   * already resolved, so it costs nothing; task writes use it to run the checks only a governed subject is held to.
   */
  governed: boolean;
}

export type ProjectAuthorizationAction = 'read' | 'update' | 'delete';

/** Subject, kernel and request cache for one user's project decisions, resolved once per request. */
async function createProjectAuthorizationContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  apiKeyId?: string | null
) {
  const requestCache = new RequestLocalAuthorizationCache();
  // A failed lookup propagates: a subject that cannot be resolved gets no decision, hence no access.
  const subject = await resolveAuthorizationSubject(conn, { tenant, user, apiKeyId, requestCache });
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: createBundleNarrowingProvider(conn),
    rbacEvaluator: async () => true,
  });

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
 * The record-level project decision for one user and action, reusable across many projects in one request (subject
 * and kernel are resolved once). Carries the kernel's redaction set and whether a built-in resolver governs the user
 * with the verdict, so a caller that renders or forwards project data can mask it and one that writes can apply the
 * checks only a governed subject is held to. `read` is decided by the kernel's resource path; `update` and `delete`
 * by its mutation path (which also runs the seat write admission gate). A row without a project id is not allowed.
 */
export async function createProjectActionDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  action: ProjectAuthorizationAction = 'read',
  apiKeyId?: string | null
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  const prepare = await createProjectAuthorizationContext(conn, tenant, user, apiKeyId);

  return async (project: ProjectAuthorizationFields): Promise<ProjectReadDecision> => {
    const projectId = project.project_id;
    if (!projectId) {
      return { allowed: false, redactedFields: [], governed: false };
    }

    const { authorizationKernel, evaluation } = prepare(projectId, project, action);
    const decision = action === 'read'
      ? await authorizationKernel.authorizeResource(evaluation)
      : await authorizationKernel.authorizeMutation(evaluation);

    return {
      allowed: decision.allowed,
      redactedFields: [...((('redactedFields' in decision ? decision.redactedFields : undefined) as string[] | undefined) ?? [])],
      governed: resolveAppliedBuiltinResolvers(evaluation).length > 0,
    };
  };
}

/** The read-action form of {@link createProjectActionDecider}. */
export async function createProjectReadDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  return createProjectActionDecider(conn, tenant, user, 'read');
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
  action: ProjectAuthorizationAction = 'read',
  apiKeyId?: string | null
): Promise<(project: ProjectAuthorizationFields) => Promise<boolean>> {
  const prepare = await createProjectAuthorizationContext(conn, tenant, user, apiKeyId);

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

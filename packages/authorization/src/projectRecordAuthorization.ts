import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
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
export type ProjectAuthorizationAction = 'read' | 'update' | 'delete';

export interface ProjectReadDecision {
  allowed: boolean;
  redactedFields: string[];
  governed: boolean;
}

export function toProjectAuthorizationRecord(project: ProjectAuthorizationFields): AuthorizationRecord {
  const assignedUserIds = typeof project.assigned_to === 'string' && project.assigned_to.length > 0
    ? [project.assigned_to]
    : [];
  return {
    id: project.project_id ?? null,
    ownerUserId: project.assigned_to ?? null,
    assignedUserIds,
    clientId: project.client_id ?? null,
  };
}

/** One project-record decision engine shared by project actions and resource retrieval. */
export async function createProjectActionDecider(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUser,
  action: ProjectAuthorizationAction = 'read',
): Promise<(project: ProjectAuthorizationFields) => Promise<ProjectReadDecision>> {
  const requestCache = new RequestLocalAuthorizationCache();
  const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: createBundleNarrowingProvider(conn),
    rbacEvaluator: async () => true,
  });

  return async project => {
    const projectId = project.project_id;
    if (!projectId) return { allowed: false, redactedFields: [], governed: false };
    const evaluation = {
      subject,
      resource: { type: 'project' as const, action, id: projectId },
      record: toProjectAuthorizationRecord(project),
      requestCache,
      knex: conn,
    };
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

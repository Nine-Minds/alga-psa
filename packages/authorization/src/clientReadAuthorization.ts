import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { resolveAuthorizationSubjectForUser } from './assetReadAuthorization';
import { BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache, createAuthorizationKernel } from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';

/** Record policy supplements the caller's coarse RBAC check for every client operation. */
export async function createClientAccessDecider(
  conn: Knex | Knex.Transaction, tenant: string, user: IUserWithRoles,
  action: 'read' | 'update' | 'delete' = 'read',
) {
  const subject = await resolveAuthorizationSubjectForUser(conn, tenant, user);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: input => resolveBundleNarrowingRulesForEvaluation(conn, input),
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();
  return async (client: { client_id?: string | null; client_name?: string | null }) => {
    if (!client.client_id) return { allowed: false, redactedFields: [] as string[] };
    const decision = await kernel.authorizeResource({ subject,
      resource: { type: 'client', action, id: client.client_id },
      record: { id: client.client_id, clientId: client.client_id }, requestCache, knex: conn });
    return { allowed: decision.allowed, redactedFields: [...(decision.redactedFields ?? [])] };
  };
}

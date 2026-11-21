import { runWithTenant } from '@alga-psa/db';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { hasPermission } from '../../auth/rbac';

interface PermissionSubjectContext {
  tenant: string;
  user?: unknown;
  viaPrincipalUserId?: string | null;
}

/**
 * Permission check for an authenticated API context. When the request was made
 * on behalf of a user through a principal (`viaPrincipalUserId` set), BOTH the
 * effective user and the principal must hold the permission, so neither can
 * borrow the other's access (PRD R5.2). Without a via principal this is exactly
 * `hasPermission(context.user, ...)`.
 *
 * The roles are read in the context's tenant. The API context is authoritative for its tenant, so
 * the answer does not depend on whether the caller also put the tenant on the user object or ran
 * the call inside an ambient tenant scope.
 */
export async function hasApiContextPermission(
  context: PermissionSubjectContext,
  resource: string,
  action: string,
  knex?: Parameters<typeof hasPermission>[3],
): Promise<boolean> {
  if (!context.user) return false;
  return runWithTenant(context.tenant, () => effectiveAndPrincipalHold(context, resource, action, knex));
}

async function effectiveAndPrincipalHold(
  context: PermissionSubjectContext,
  resource: string,
  action: string,
  knex?: Parameters<typeof hasPermission>[3],
): Promise<boolean> {
  if (!(await hasPermission(context.user as Parameters<typeof hasPermission>[0], resource, action, knex))) {
    return false;
  }
  if (!context.viaPrincipalUserId) return true;
  // findUserByIdForApi only returns active users; an inactive principal holds nothing.
  const principal = await findUserByIdForApi(context.viaPrincipalUserId, context.tenant);
  if (!principal) return false;
  return hasPermission(principal as Parameters<typeof hasPermission>[0], resource, action, knex);
}

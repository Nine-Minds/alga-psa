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
 */
export async function hasApiContextPermission(
  context: PermissionSubjectContext,
  resource: string,
  action: string,
  knex?: Parameters<typeof hasPermission>[3],
): Promise<boolean> {
  if (!context.user) return false;
  if (!(await hasPermission(context.user as Parameters<typeof hasPermission>[0], resource, action, knex))) {
    return false;
  }
  if (!context.viaPrincipalUserId) return true;
  // findUserByIdForApi only returns active users; an inactive principal holds nothing.
  const principal = await findUserByIdForApi(context.viaPrincipalUserId, context.tenant);
  if (!principal) return false;
  return hasPermission(principal as Parameters<typeof hasPermission>[0], resource, action, knex);
}

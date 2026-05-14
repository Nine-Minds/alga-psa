import type { AclMetadata } from './types';

export interface ComposedAclHints {
  visibleToUserIds: string[];
  visibleToRoles: string[];
  isInternalOnly: boolean;
  isPrivate: boolean;
  clientScopeId?: string;
  requiredPermission?: string;
}

export interface SearchAclPrincipal {
  userId: string;
  permissions: string[];
  roles?: string[];
  isInternal?: boolean;
  accessibleClientIds?: string[];
}

export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

export function composeAclHints(opts: AclMetadata = {}): ComposedAclHints {
  return {
    visibleToUserIds: opts.visibleToUserIds ?? [],
    visibleToRoles: opts.visibleToRoles ?? [],
    isInternalOnly: opts.isInternalOnly ?? false,
    isPrivate: opts.isPrivate ?? false,
    clientScopeId: opts.clientScopeId,
    requiredPermission: opts.requiredPermission,
  };
}

export function aclPredicateSql(user: SearchAclPrincipal): SqlFragment {
  return {
    sql: `
      (
        (required_permission IS NULL OR required_permission = ANY(?::text[]))
        AND (cardinality(visible_to_user_ids) = 0 OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND (cardinality(visible_to_roles) = 0 OR visible_to_roles && ?::text[])
        AND (is_internal_only = false OR ?::boolean = true)
        AND (is_private = false OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND (client_scope_id IS NULL OR client_scope_id = ANY(?::uuid[]))
      )
    `,
    bindings: [
      user.permissions,
      user.userId,
      user.roles ?? [],
      user.isInternal ?? false,
      user.userId,
      user.accessibleClientIds ?? [],
    ],
  };
}

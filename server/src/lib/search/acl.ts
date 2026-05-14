import User from '@alga-psa/db/models/user';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

import type { AclMetadata } from './types';

const RESOURCE_CANONICAL_MAP: Record<string, string> = {
  timeentry: 'time_entry',
  time_entry: 'time_entry',
  timesheet: 'time_sheet',
  time_sheet: 'time_sheet',
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

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

export async function resolveSearchAclPrincipal(
  knex: Knex,
  user: Pick<IUserWithRoles, 'user_id' | 'user_type'>,
  accessibleClientIds: string[] = [],
): Promise<SearchAclPrincipal> {
  const rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  const isClientPortal = user.user_type === 'client';
  const permissions = new Set<string>();
  const roles = new Set<string>();

  for (const role of rolesWithPermissions) {
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;

    roles.add(role.role_name);

    for (const permission of role.permissions) {
      if (isClientPortal && !permission.client) continue;
      if (!isClientPortal && !permission.msp) continue;
      permissions.add(`${canonicalizeResource(permission.resource)}:${permission.action}`);
    }
  }

  return {
    userId: user.user_id,
    permissions: [...permissions],
    roles: [...roles],
    isInternal: !isClientPortal,
    accessibleClientIds,
  };
}

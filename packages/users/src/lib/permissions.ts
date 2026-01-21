// TODO: Consolidate with @alga-psa/auth after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

import type { IUser, IRoleWithPermissions } from '@alga-psa/types';
import User from '@alga-psa/db/models/user';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { Knex } from 'knex';

/**
 * Permission-related error utilities
 */

export function formatPermissionError(action: string, resource?: string): string {
  if (resource) {
    return `Permission denied: You don't have permission to ${action} ${resource}`;
  }
  return `Permission denied: You don't have permission to ${action}`;
}

export function throwPermissionError(action: string, additionalInfo?: string): never {
  const baseMessage = formatPermissionError(action);
  const fullMessage = additionalInfo ? `${baseMessage}. ${additionalInfo}` : baseMessage;
  throw new Error(fullMessage);
}

const RESOURCE_CANONICAL_MAP: Record<string, string> = {
  client: 'client'
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

export async function hasPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<boolean> {
  if (!user.tenant) {
    throw new Error('Tenant is required');
  }

  return runWithTenant(user.tenant, async () => {
    const normalizedResource = canonicalizeResource(resource);
    let rolesWithPermissions: IRoleWithPermissions[];

    if (knexConnection) {
      rolesWithPermissions = await User.getUserRolesWithPermissions(knexConnection, user.user_id);
    } else {
      const { knex } = await createTenantKnex(user.tenant);
      rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
    }

    const isClientPortal = user.user_type === 'client';

    for (const role of rolesWithPermissions) {
      if (isClientPortal && !role.client) continue;
      if (!isClientPortal && !role.msp) continue;

      for (const permission of role.permissions) {
        if (isClientPortal && !permission.client) continue;
        if (!isClientPortal && !permission.msp) continue;

        if (canonicalizeResource(permission.resource) === normalizedResource && permission.action === action) {
          return true;
        }
      }
    }
    return false;
  });
}

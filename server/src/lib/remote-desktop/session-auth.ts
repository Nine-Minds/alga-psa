/**
 * Remote Desktop Session Authorization
 *
 * Handles permission checks for remote desktop session operations.
 */

import { Knex } from 'knex';
import {
  RemoteAccessPermission,
  PermissionCapability,
  mergePermissions,
  checkCapabilities,
  sanitizePermissions,
  DEFAULT_PERMISSIONS,
} from './permissions';

/**
 * Result of a session permission check
 */
export interface SessionPermissionResult {
  allowed: boolean;
  reason?: string;
  permissions?: RemoteAccessPermission;
  deniedCapabilities?: PermissionCapability[];
}

/**
 * Session capabilities that can be requested
 */
export type SessionCapability =
  | 'view'
  | 'control'
  | 'terminal'
  | 'files'
  | 'elevate';

/**
 * Map session capabilities to permission capabilities
 */
const CAPABILITY_MAP: Record<SessionCapability, PermissionCapability[]> = {
  view: ['canConnect', 'canViewScreen'],
  control: ['canConnect', 'canViewScreen', 'canControlInput'],
  terminal: ['canConnect', 'canAccessTerminal'],
  files: ['canConnect', 'canTransferFiles'],
  elevate: ['canConnect', 'canControlInput', 'canElevate'],
};

/**
 * Get user's remote desktop permissions from their role
 */
export async function getUserRemotePermissions(
  db: Knex,
  tenant: string,
  userId: string
): Promise<RemoteAccessPermission | null> {
  // Get user's roles and their permissions
  const result = await db.raw(`
    SELECT
      u.user_id,
      r.role_id,
      r.role_name,
      COALESCE(r.permissions->>'remote_desktop', '{}')::jsonb as remote_permissions
    FROM users u
    JOIN user_roles ur ON ur.tenant = u.tenant AND ur.user_id = u.user_id
    JOIN roles r ON r.tenant = ur.tenant AND r.role_id = ur.role_id
    WHERE u.tenant = ? AND u.user_id = ?
  `, [tenant, userId]);

  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  // Merge permissions from all roles (most permissive wins for each capability)
  let mergedPermissions: RemoteAccessPermission = { ...DEFAULT_PERMISSIONS };

  for (const row of result.rows) {
    const rolePermissions = row.remote_permissions as Partial<RemoteAccessPermission>;
    if (rolePermissions && typeof rolePermissions === 'object') {
      // For each capability, take the more permissive value
      mergedPermissions = {
        canConnect: mergedPermissions.canConnect || Boolean(rolePermissions.canConnect),
        canViewScreen: mergedPermissions.canViewScreen || Boolean(rolePermissions.canViewScreen),
        canControlInput: mergedPermissions.canControlInput || Boolean(rolePermissions.canControlInput),
        canAccessTerminal: mergedPermissions.canAccessTerminal || Boolean(rolePermissions.canAccessTerminal),
        canTransferFiles: mergedPermissions.canTransferFiles || Boolean(rolePermissions.canTransferFiles),
        canElevate: mergedPermissions.canElevate || Boolean(rolePermissions.canElevate),
        // For consent, take the less restrictive (false if any role doesn't require it)
        requiresUserConsent: mergedPermissions.requiresUserConsent && (rolePermissions.requiresUserConsent !== false),
        // For duration limit, take the highest (most permissive)
        sessionDurationLimit: Math.max(
          mergedPermissions.sessionDurationLimit ?? 0,
          rolePermissions.sessionDurationLimit ?? 0
        ) || undefined,
      };
    }
  }

  return mergedPermissions;
}

/**
 * Get agent's permissions
 */
export async function getAgentPermissions(
  db: Knex,
  tenant: string,
  agentId: string
): Promise<RemoteAccessPermission | null> {
  const result = await db('rd_agents')
    .select('permissions')
    .where({ tenant, agent_id: agentId })
    .first();

  if (!result) {
    return null;
  }

  return sanitizePermissions(result.permissions || {});
}

/**
 * Check if a user can create a session with requested capabilities
 */
export async function checkSessionPermissions(
  db: Knex,
  tenant: string,
  userId: string,
  agentId: string,
  requestedCapabilities: SessionCapability[]
): Promise<SessionPermissionResult> {
  // Get user permissions
  const userPermissions = await getUserRemotePermissions(db, tenant, userId);
  if (!userPermissions) {
    return {
      allowed: false,
      reason: 'User not found or has no remote access permissions',
    };
  }

  // Check basic connection permission
  if (!userPermissions.canConnect) {
    return {
      allowed: false,
      reason: 'User lacks remote access permission',
    };
  }

  // Get agent permissions
  const agentPermissions = await getAgentPermissions(db, tenant, agentId);
  if (!agentPermissions) {
    return {
      allowed: false,
      reason: 'Agent not found',
    };
  }

  // Merge user and agent permissions (most restrictive wins)
  const effectivePermissions = mergePermissions(userPermissions, agentPermissions);

  // Convert session capabilities to permission capabilities
  const requiredCapabilities: PermissionCapability[] = [];
  for (const capability of requestedCapabilities) {
    const mapped = CAPABILITY_MAP[capability];
    if (mapped) {
      for (const cap of mapped) {
        if (!requiredCapabilities.includes(cap)) {
          requiredCapabilities.push(cap);
        }
      }
    }
  }

  // Check if effective permissions allow all requested capabilities
  const { allowed, deniedCapabilities } = checkCapabilities(
    effectivePermissions,
    requiredCapabilities
  );

  if (!allowed) {
    return {
      allowed: false,
      reason: `Permission denied: missing capabilities ${deniedCapabilities.join(', ')}`,
      deniedCapabilities,
    };
  }

  return {
    allowed: true,
    permissions: effectivePermissions,
  };
}

/**
 * Check if a data channel operation is allowed for a session
 */
export function checkDataChannelPermission(
  sessionPermissions: RemoteAccessPermission,
  channel: string,
  operation: string
): { allowed: boolean; reason?: string } {
  switch (channel) {
    case 'input':
      if (!sessionPermissions.canControlInput) {
        return {
          allowed: false,
          reason: 'Permission denied: canControlInput',
        };
      }
      break;

    case 'terminal':
      if (!sessionPermissions.canAccessTerminal) {
        return {
          allowed: false,
          reason: 'Permission denied: canAccessTerminal',
        };
      }
      // Check for elevation attempt
      if (operation === 'elevate' && !sessionPermissions.canElevate) {
        return {
          allowed: false,
          reason: 'Permission denied: canElevate',
        };
      }
      break;

    case 'files':
      if (!sessionPermissions.canTransferFiles) {
        return {
          allowed: false,
          reason: 'Permission denied: canTransferFiles',
        };
      }
      break;

    case 'video':
      if (!sessionPermissions.canViewScreen) {
        return {
          allowed: false,
          reason: 'Permission denied: canViewScreen',
        };
      }
      break;

    default:
      // Unknown channel, deny by default
      return {
        allowed: false,
        reason: `Unknown channel: ${channel}`,
      };
  }

  return { allowed: true };
}

/**
 * Check if a session has exceeded its duration limit
 */
export function checkSessionDuration(
  permissions: RemoteAccessPermission,
  sessionStartTime: Date
): { allowed: boolean; remainingMinutes?: number } {
  if (!permissions.sessionDurationLimit) {
    return { allowed: true };
  }

  const elapsedMinutes = (Date.now() - sessionStartTime.getTime()) / (1000 * 60);
  const remainingMinutes = permissions.sessionDurationLimit - elapsedMinutes;

  if (remainingMinutes <= 0) {
    return {
      allowed: false,
      remainingMinutes: 0,
    };
  }

  return {
    allowed: true,
    remainingMinutes: Math.floor(remainingMinutes),
  };
}

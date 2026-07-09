'use server';

import User from '@alga-psa/db/models/user';
import { IUser, IRole, IUserWithRoles, IRoleWithPermissions, IUserRole } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import UserPreferences from '@alga-psa/db/models/userPreferences';
import { getUserAvatarUrl } from '../lib/avatarUtils';
import { hasPermission } from '../lib/permissions';
import logger from '@alga-psa/core/logger';
import { getCurrentUser, withAuth, withOptionalAuth } from '@alga-psa/auth';

export { getCurrentUser };

function isPermissionDeniedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Permission denied:');
}

function isInvalidUserQueryReference(error: unknown): boolean {
  const dbError = error as { code?: string };
  return dbError?.code === '22P02' || dbError?.code === '23503';
}

function isExpectedUserQueryError(error: unknown): boolean {
  return isPermissionDeniedError(error) || isInvalidUserQueryReference(error);
}

export const findUserById = withAuth(async (
  currentUser,
  _ctx,
  id: string
): Promise<IUserWithRoles | null> => {
  try {
    const {knex} = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user');
      }

      const user = await User.getUserWithRoles(trx, id);
      return user || null;
    });
  } catch (error) {
    logger.error(`Failed to find user with id ${id}:`, error);
    if (isExpectedUserQueryError(error)) {
      return null;
    }
    throw error;
  }
});

/**
 * Get all users without roles - more efficient for components that only need basic user info
 * (e.g., UserPicker, dropdowns, assignments)
 */
export const getAllUsersBasic = withAuth(async (
  currentUser,
  { tenant },
  includeInactive: boolean = true,
  userType?: string
): Promise<IUser[]> => {
  try {
    const {knex} = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read users');
      }

      const users = await User.getAll(trx, includeInactive);

      // Filter by tenant and optionally by user_type
      return users.filter(user =>
        user.tenant === tenant &&
        (userType ? user.user_type === userType : true)
      );
    });
  } catch (error) {
    logger.error('Failed to fetch users:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

export const getAllUsers = withAuth(async (
  currentUser,
  { tenant },
  includeInactive: boolean = true,
  userType?: string
): Promise<IUserWithRoles[]> => {
  try {
    const {knex} = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read users');
      }

      const users = await User.getAll(trx, includeInactive);

      // Filter by tenant and optionally by user_type first to reduce role fetching
      const filteredUsers = users.filter(user =>
        user.tenant === tenant &&
        (userType ? user.user_type === userType : true)
      );

      // Fetch all roles in a single query (avoids N+1)
      const userIds = filteredUsers.map(u => u.user_id);
      const rolesByUser = await User.getUserRolesBulk(trx, userIds);

      return filteredUsers.map((user): IUserWithRoles => ({
        ...user,
        roles: rolesByUser.get(user.user_id) || []
      }));
    });
  } catch (error) {
    logger.error('Failed to fetch users:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

export const getReportsToSubordinates = withAuth(async (
  currentUser,
  { tenant },
  managerUserId?: string
): Promise<IUser[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      const targetManagerId = managerUserId || currentUser.user_id;
      const canReadUsers = await hasPermission(currentUser, 'user', 'read', trx);

      if (targetManagerId !== currentUser.user_id && !canReadUsers) {
        throw new Error('Permission denied: Cannot read other users reporting chains');
      }

      const subordinateIds = await User.getReportsToSubordinateIds(trx, targetManagerId);
      if (subordinateIds.length === 0) {
        return [] as IUser[];
      }

      const rows = await tenantDb(trx, tenant)
        .table('users')
        .whereIn('user_id', subordinateIds)
        .select('*');

      return rows as IUser[];
    });
  } catch (error) {
    logger.error('Failed to fetch reports_to subordinates:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

export const getUserRoles = withAuth(async (
  _user,
  _ctx,
  userId: string
): Promise<IRole[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await User.getUserRoles(knex, userId);
  } catch (error) {
    logger.error(`Failed to fetch roles for user with id ${userId}:`, error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

export const getAllRoles = withAuth(async (_user, { tenant }): Promise<IRole[]> => {
  try {
    const {knex: db} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await tenantDb(trx, tenant)
        .table<IRole>('roles')
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch all roles:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

/**
 * Get MSP roles only (roles with msp flag = true)
 */
export const getMSPRoles = withAuth(async (_user, { tenant }): Promise<IRole[]> => {
  try {
    const {knex: db} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await tenantDb(trx, tenant)
        .table<IRole>('roles')
        .where({
          msp: true
        })
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch MSP roles:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

/**
 * Get Client Portal roles only (roles with client flag = true)
 */
export const getClientPortalRoles = withAuth(async (_user, { tenant }): Promise<IRole[]> => {
  try {
    const {knex: db} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await tenantDb(trx, tenant)
        .table<IRole>('roles')
        .where({
          client: true
        })
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch client portal roles:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

export const getUserRolesWithPermissions = withAuth(async (
  currentUser,
  _ctx,
  userId: string,
  knexConnection?: Knex | Knex.Transaction
): Promise<IRoleWithPermissions[]> => {
  try {
    let knex: Knex | Knex.Transaction;
    if (knexConnection) {
      knex = knexConnection;
      // If we have a connection passed in, check permissions directly
      if (!await hasPermission(currentUser, 'user', 'read', knex)) {
        throw new Error('Permission denied: Cannot read user roles with permissions');
      }
      const rolesWithPermissions = await User.getUserRolesWithPermissions(knex, userId);
      return rolesWithPermissions;
    } else {
      const result = await createTenantKnex();
      knex = result.knex;

      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read user roles with permissions');
        }

        const rolesWithPermissions = await User.getUserRolesWithPermissions(trx, userId);
        return rolesWithPermissions;
      });
    }
  } catch (error) {
    logger.error(`Failed to fetch roles with permissions for user with id ${userId}:`, error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

/**
 * Retrieves a flattened list of unique permission strings for the current user.
 * @returns Promise<string[]> A promise that resolves to an array of unique permission strings.
 */
export const getCurrentUserPermissions = withOptionalAuth(async (
  currentUser,
  _ctx
): Promise<string[]> => {
  try {
    if (!currentUser) {
      logger.debug('No current user found, returning empty permissions.');
      return [];
    }

    const rolesWithPermissions = await getUserRolesWithPermissions(currentUser.user_id);

    // Flatten permissions from all roles and make them unique
    const allPermissions = rolesWithPermissions.reduce((acc, role) => {
      if (role.permissions) {
        role.permissions.forEach(permission => {
          const permissionString = `${permission.resource}:${permission.action}`;
          acc.add(permissionString);
        });
      }
      return acc;
    }, new Set<string>());

    logger.debug(`User ${currentUser.user_id} has permissions: ${Array.from(allPermissions).join(', ')}`);
    return Array.from(allPermissions);
  } catch (error) {
    logger.error('Failed to get current user permissions:', error);
    // Depending on requirements, you might want to return empty array or re-throw
    // Returning empty array for now to avoid breaking flows that might expect an array
    return [];
  }
});

export const getUserWithRoles = withAuth(async (
  currentUser,
  _ctx,
  userId: string
): Promise<IUserWithRoles | null> => {
  try {
    const {knex} = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user with roles');
      }

      const user = await User.getUserWithRoles(trx, userId);
      return user || null;
    });
  } catch (error) {
    logger.error(`Failed to fetch user with roles for id ${userId}:`, error);
    if (isExpectedUserQueryError(error)) {
      return null;
    }
    throw error;
  }
});

export const getMultipleUsersWithRoles = withAuth(async (
  currentUser,
  _ctx,
  userIds: string[]
): Promise<IUserWithRoles[]> => {
  try {
    const {knex} = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read multiple users with roles');
      }

      const users = await Promise.all(userIds.map((id: string): Promise<IUserWithRoles | undefined> => User.getUserWithRoles(trx, id)));
      return users.filter((user): user is IUserWithRoles => user !== undefined);
    });
  } catch (error) {
    logger.error('Failed to fetch multiple users with roles:', error);
    if (isExpectedUserQueryError(error)) {
      return [];
    }
    throw error;
  }
});

// User Preferences Actions
export const getUserPreference = withAuth(async (
  _user,
  _ctx,
  userId: string,
  settingName: string
): Promise<any> => {
  try {
    const {knex} = await createTenantKnex();
    const preference = await UserPreferences.get(knex, userId, settingName);
    if (!preference?.setting_value) return null;

    try {
      // Try to parse the JSON value
      return JSON.parse(preference.setting_value);
    } catch (e) {
      // If parsing fails, return the raw value
      return preference.setting_value;
    }
  } catch (error) {
    logger.error('Failed to get user preference:', error);
    if (isExpectedUserQueryError(error)) {
      return null;
    }
    throw error;
  }
});

export const getUserPreferencesBatch = withAuth(async (
  _user,
  _ctx,
  userId: string,
  settingNames: string[]
): Promise<Record<string, any>> => {
  try {
    const {knex} = await createTenantKnex();
    const allPrefs = await UserPreferences.getAllForUser(knex, userId);
    const result: Record<string, any> = {};
    const nameSet = new Set(settingNames);
    for (const pref of allPrefs) {
      if (nameSet.has(pref.setting_name)) {
        if (pref.setting_value) {
          try {
            result[pref.setting_name] = JSON.parse(pref.setting_value);
          } catch {
            result[pref.setting_name] = pref.setting_value;
          }
        }
      }
    }
    return result;
  } catch (error) {
    logger.error('Failed to get user preferences batch:', error);
    if (isExpectedUserQueryError(error)) {
      return {};
    }
    throw error;
  }
});

export const setUserPreference = withAuth(async (
  _user,
  _ctx,
  userId: string,
  settingName: string,
  settingValue: any
): Promise<void> => {
  try {
    // Convert the value to a JSON string
    const jsonValue = JSON.stringify(settingValue);

    const {knex} = await createTenantKnex();
    await UserPreferences.upsert(knex, {
      user_id: userId,
      setting_name: settingName,
      setting_value: jsonValue,
      updated_at: new Date()
    });
  } catch (error) {
    logger.error('Failed to set user preference:', error);
    throw error;
  }
});

export const getUserClientId = withAuth(async (
  currentUser,
  { tenant },
  userId: string
): Promise<string | null> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // For client users accessing their own client ID, no permission check needed
      // For other users, check user:read permission
      if (currentUser.user_id !== userId && !await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user client ID');
      }

      const user = await User.get(trx, userId); // Use User.get which includes tenant context
      if (!user) return null;

      // First try to get client ID from contact if user is contact-based
      if (user.contact_id) {
        const contact = await tenantDb(trx, tenant)
          .table('contacts')
          .where({
            contact_name_id: user.contact_id,
          })
          .select('client_id')
          .first();

        if (contact?.client_id) {
          return contact.client_id;
        }
      }

      // Email suffix functionality removed for security
      return null;
    });
  } catch (error) {
    logger.error('Error getting user client ID:', error);
    if (isExpectedUserQueryError(error)) {
      return null;
    }
    throw error;
  }
});

/**
 * Gets the contact_id for a user, which is needed for fetching contact avatars
 * @param userId The user ID to get the contact_id for
 * @returns The contact_id if found, null otherwise
 */
export const getUserContactId = withAuth(async (
  currentUser,
  { tenant },
  userId: string
): Promise<string | null> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user contact ID');
      }

      const user = await tenantDb(trx, tenant)
        .table('users')
        .where({
          user_id: userId,
        })
        .select('contact_id')
        .first();

      return user?.contact_id || null;
    });
  } catch (error) {
    logger.error('Error getting user contact ID:', error);
    if (isExpectedUserQueryError(error)) {
      return null;
    }
    throw error;
  }
});

export const getClientUsersForClient = withAuth(async (
  currentUser,
  { tenant },
  clientId: string
): Promise<IUser[]> => {
  try {
    const { knex } = await createTenantKnex();

    // Get all users associated with the client
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read client users for client');
      }

      const db = tenantDb(trx, tenant);
      const usersQuery = db.table<IUser>('users');
      db.tenantJoin(usersQuery, 'contacts', 'users.contact_id', 'contacts.contact_name_id');

      const users = await usersQuery
        .where('contacts.client_id', clientId)
        .where('users.user_type', 'client')
        .select<IUser[]>('users.*');

      return users;
    });
  } catch (error) {
    logger.error('Error getting client users:', error);
    throw error;
  }
});

// Alias for compatibility
export const getUserById = findUserById;

/**
 * Get the current user's avatar URL (server action for client components)
 */
export const getCurrentUserAvatarUrl = withOptionalAuth(async (
  user,
  ctx
): Promise<string | null> => {
  try {
    if (!user || !ctx) {
      return null;
    }

    return await getUserAvatarUrl(user.user_id, ctx.tenant);
  } catch (error) {
    logger.error('Error getting current user avatar URL:', error);
    return null;
  }
});

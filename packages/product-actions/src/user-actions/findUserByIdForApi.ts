/**
 * Find user by ID for API context
 * This version doesn't require session context and is used for API authentication
 */

import { Knex } from 'knex';
import { getConnection } from '@server/lib/db/db';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import User from '@server/lib/models/user';
import { getUserAvatarUrl } from '@server/lib/utils/avatarUtils';

/**
 * Find a user by ID within a specific tenant context
 * Used during API authentication where we don't have session context
 */
export async function findUserByIdForApi(
  userId: string, 
  tenantId: string
): Promise<IUserWithRoles | null> {
  try {
    const knex = await getConnection(tenantId);
    
    // Get user with their basic info
    const user = await knex('users')
      .where({ 
        user_id: userId,
        tenant: tenantId,
        is_inactive: false
      })
      .first();
    
    if (!user) {
      console.log(`User ${userId} not found in tenant ${tenantId}`);
      return null;
    }

    // Get user roles
    const roles = await User.getUserRoles(knex, userId);
    
    // Get avatar URL
    const avatarUrl = await getUserAvatarUrl(userId, tenantId);

    return {
      ...user,
      roles,
      avatarUrl
    };
  } catch (error) {
    console.error(`Failed to find user ${userId} in tenant ${tenantId}:`, error);
    throw error;
  }
}
'use server';

/**
 * Find user by ID for API context
 * This version doesn't require session context and is used for API authentication
 */

import { tenantDb, getConnection, runWithTenant } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import { getUserAvatarUrl } from '@alga-psa/user-composition/lib/avatarUtils';
import { API_USER_CONTEXT_COLUMNS, type SafeApiUser } from '../../services/userResponseSanitizer';

/**
 * Find a user by ID within a specific tenant context
 * Used during API authentication where we don't have session context
 */
export async function findUserByIdForApi(
  userId: string, 
  tenantId: string
): Promise<SafeApiUser | null> {
  try {
    return await runWithTenant(tenantId, async () => {
      const knex = await getConnection(tenantId);

      // Get user with their basic info
      const user = await tenantDb(knex, tenantId).table('users')
        .where({ 
          user_id: userId,
          is_inactive: false
        })
        .select(API_USER_CONTEXT_COLUMNS)
        .first();

      if (!user) {
        console.log(`User ${userId} not found in tenant ${tenantId}`);
        return null;
      }

      // Get user roles
      const roles = await User.getUserRoles(knex, userId, tenantId);

      // Get avatar URL
      const avatarUrl = await getUserAvatarUrl(userId, tenantId);

      // Resolve the authoritative client scope for a client user from the
      // tenant-scoped contact relation — never from headers, payloads, role
      // names, or API-key metadata. A missing contact, a client-less contact,
      // or a cross-tenant association leaves the client ID unresolved; such a
      // user is already rejected at the API surface and the kernel rule denies
      // record access independently.
      let clientId: string | undefined;
      if (user.user_type === 'client' && user.contact_id) {
        const contact = await tenantDb(knex, tenantId).table('contacts')
          .where({ contact_name_id: user.contact_id })
          .first('client_id');
        if (typeof contact?.client_id === 'string' && contact.client_id.length > 0) {
          clientId = contact.client_id;
        }
      }

      return {
        ...user,
        roles,
        avatarUrl,
        ...(clientId !== undefined ? { clientId } : {}),
      };
    });
  } catch (error) {
    console.error(`Failed to find user ${userId} in tenant ${tenantId}:`, error);
    throw error;
  }
}

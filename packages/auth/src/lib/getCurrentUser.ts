import type { IUserWithRoles } from '@alga-psa/types';
import { getUserWithRoles, getUserWithRolesByEmail, createTenantKnex } from '@alga-psa/db';
import { getSession } from './getSession';
import logger from '@alga-psa/core/logger';
import { getUserAvatarUrl } from '@alga-psa/media';

export async function getCurrentUser(): Promise<IUserWithRoles | null> {
  try {
    logger.debug('Getting current user from session');
    const session = await getSession();

    if (!session?.user) {
      logger.debug('No user found in session');
      return null;
    }

    // Use the user ID from the session if available (most reliable)
    const sessionUser = session.user as any;
    if (sessionUser.id && sessionUser.tenant) {
      logger.debug(`Using user ID from session: ${sessionUser.id}, tenant: ${sessionUser.tenant}`);

      const userWithRoles = await getUserWithRoles(
        sessionUser.id,
        sessionUser.tenant,
        getUserAvatarUrl
      );

      if (!userWithRoles) {
        logger.debug(`User not found for ID: ${sessionUser.id} in tenant: ${sessionUser.tenant}`);
        return null;
      }

      logger.debug(`Current user retrieved successfully: ${userWithRoles.user_id} with ${userWithRoles.roles?.length || 0} roles`);
      return userWithRoles;
    }

    // Fallback paths should fail in production for security
    if (process.env.NODE_ENV === 'production') {
      logger.error('Session missing user ID or tenant - cannot safely retrieve user in production');
      return null;
    }

    // Development-only fallbacks with warnings
    if (!session.user.email) {
      logger.debug('No user email found in session');
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Falling back to email lookup for: ${session.user.email} - this is unsafe in production`);

    // Get current tenant from context
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      logger.error('No tenant context available for email-based lookup');
      return null;
    }

    // If we have user type in session, use it for more accurate lookup
    if (sessionUser.user_type && session.user?.email) {
      logger.debug(`Looking up user by email and type: ${session.user.email}, ${sessionUser.user_type}, tenant: ${tenant}`);

      const userWithRoles = await getUserWithRolesByEmail(
        session.user.email,
        tenant,
        sessionUser.user_type,
        getUserAvatarUrl
      );

      if (!userWithRoles) {
        logger.debug(`User not found for email: ${session.user.email}, type: ${sessionUser.user_type}, tenant: ${tenant}`);
        return null;
      }

      logger.debug(`Current user retrieved successfully: ${userWithRoles.user_id} with ${userWithRoles.roles?.length || 0} roles`);
      return userWithRoles;
    }

    // Last resort: email-only lookup (development only)
    if (!session.user?.email) {
      logger.error('Session user email is missing');
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Email-only lookup for: ${session.user.email} in tenant: ${tenant}`);

    const userWithRoles = await getUserWithRolesByEmail(
      session.user.email,
      tenant,
      undefined,
      getUserAvatarUrl
    );

    if (!userWithRoles) {
      logger.debug(`User not found for email: ${session.user.email} in tenant: ${tenant}`);
      return null;
    }

    logger.debug(`Current user retrieved successfully: ${userWithRoles.user_id} with ${userWithRoles.roles?.length || 0} roles`);
    return userWithRoles;
  } catch (error) {
    logger.error('Failed to get current user:', error);
    // Preserve the original error and stack trace
    throw error;
  }
}

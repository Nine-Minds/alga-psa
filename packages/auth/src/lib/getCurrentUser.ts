import type { IUserWithRoles } from '@alga-psa/types';
import { getUserWithRoles, getUserWithRolesByEmail, createTenantKnex } from '@alga-psa/db';
import { getApiKeyUserOverride } from './apiKeyUserContext';
import { getSession } from './getSession';
import logger from '@alga-psa/core/logger';
// Note: Avatar URLs are NOT fetched here to avoid circular dependency with @alga-psa/documents.
// If avatar URL is needed, use getUserAvatarUrl from @alga-psa/documents separately.

/**
 * Deactivation (by an administrator or by SCIM) must deny access on the next
 * request, not merely at the next sign-in, so an inactive user resolves to no
 * caller at all.
 */
function activeUserOrNull(user: IUserWithRoles | null): IUserWithRoles | null {
  if (!user) {
    return null;
  }

  if (user.is_inactive) {
    logger.warn(`Rejecting request from inactive user ${user.user_id}`);
    return null;
  }

  return user;
}

export async function getCurrentUser(): Promise<IUserWithRoles | null> {
  try {
    // API-key routes establish the caller's identity explicitly (see
    // apiKeyUserContext); it takes precedence over any ambient session.
    const apiKeyUser = getApiKeyUserOverride();
    if (apiKeyUser) {
      return apiKeyUser;
    }

    const session = await getSession();

    if (!session?.user) {
      return null;
    }

    // Use the user ID from the session if available (most reliable)
    const sessionUser = session.user as any;
    if (sessionUser.id && sessionUser.tenant) {
      const userWithRoles = await getUserWithRoles(
        sessionUser.id,
        sessionUser.tenant
      );

      return activeUserOrNull(userWithRoles);
    }

    // Fallback paths should fail in production for security
    if (process.env.NODE_ENV === 'production') {
      logger.error('Session missing user ID or tenant - cannot safely retrieve user in production');
      return null;
    }

    // Development-only fallbacks with warnings
    if (!session.user.email) {
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Falling back to email lookup for: ${session.user.email} - this is unsafe in production`);

    // Get tenant from session if available, otherwise fall back to context
    let tenant = sessionUser.tenant;
    if (!tenant) {
      const { tenant: contextTenant } = await createTenantKnex();
      tenant = contextTenant;
    }
    if (!tenant) {
      logger.error('No tenant context available for email-based lookup');
      return null;
    }

    // If we have user type in session, use it for more accurate lookup
    if (sessionUser.user_type && session.user?.email) {
      const userWithRoles = await getUserWithRolesByEmail(
        session.user.email,
        tenant,
        sessionUser.user_type
      );

      return activeUserOrNull(userWithRoles);
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
      undefined
    );

    return activeUserOrNull(userWithRoles);
  } catch (error) {
    logger.error('Failed to get current user:', error);
    // Preserve the original error and stack trace
    throw error;
  }
}

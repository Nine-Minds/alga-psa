/**
 * Users helpers for tags package
 *
 * Uses static imports now that the ui → tags cycle has been broken
 * by moving tag components from ui to tags.
 */

import type { IUserWithRoles } from '@alga-psa/types';
import { getUserWithRoles, getUserWithRolesByEmail, createTenantKnex } from '@alga-psa/db';
import { getSession } from '@alga-psa/auth';
import { getUserAvatarUrl } from '@alga-psa/documents';

/**
 * Get the current user from the session.
 * This is a local implementation to avoid circular dependencies.
 */
export async function getCurrentUserAsync(): Promise<IUserWithRoles | null> {
  try {
    const session = await getSession();

    if (!session?.user) {
      return null;
    }

    const sessionUser = session.user as any;
    if (sessionUser.id && sessionUser.tenant) {
      return await getUserWithRoles(
        sessionUser.id,
        sessionUser.tenant,
        getUserAvatarUrl
      );
    }

    // Fallback paths should fail in production for security
    if (process.env.NODE_ENV === 'production') {
      return null;
    }

    // Development-only fallbacks
    if (!session.user.email) {
      return null;
    }

    // In development, fall back to tenant from session or first tenant
    const sessionTenant = sessionUser.tenant;
    const { tenant } = await createTenantKnex(sessionTenant);
    if (!tenant) {
      return null;
    }

    if (sessionUser.user_type && session.user?.email) {
      return await getUserWithRolesByEmail(
        session.user.email,
        tenant,
        sessionUser.user_type,
        getUserAvatarUrl
      );
    }

    if (!session.user?.email) {
      return null;
    }

    return await getUserWithRolesByEmail(
      session.user.email,
      tenant,
      undefined,
      getUserAvatarUrl
    );
  } catch (error) {
    console.error('[tags] Failed to get current user:', error);
    throw error;
  }
}

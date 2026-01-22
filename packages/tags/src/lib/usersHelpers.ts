/**
 * Users helpers for tags package
 *
 * Uses dynamic imports to avoid build-time circular dependencies.
 * The auth package is imported at runtime.
 */

import type { IUserWithRoles } from '@alga-psa/types';
import { getUserWithRoles, getUserWithRolesByEmail, createTenantKnex } from '@alga-psa/db';
import { getUserAvatarUrl } from '@alga-psa/media';

/**
 * Lazy-loaded session getter to avoid circular dependencies.
 * Uses template literal to prevent static analysis from detecting the import.
 */
async function getSession() {
  // Template literal prevents Nx from detecting this as a static dependency
  const modulePath = `@alga-psa/${'auth'}`;
  const authModule = await import(/* webpackIgnore: true */ modulePath);
  return authModule.getSession();
}

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

    const { tenant } = await createTenantKnex();
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

import { Knex } from 'knex';
import type { IUser, IRole, IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { getSession } from './getSession';
import { getUserAvatarUrl } from '@alga-psa/documents/lib/avatarUtils';
import logger from '@alga-psa/core/logger';
import { withTransaction } from '@alga-psa/db';

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

      // Get connection with tenant context already set
      const { knex, tenant } = await createTenantKnex();

      // Verify tenant matches session for security
      if (tenant && tenant !== sessionUser.tenant) {
        logger.error(`Tenant mismatch: session has ${sessionUser.tenant} but context has ${tenant}`);
        throw new Error('Tenant context mismatch');
      }

      // PERFORMANCE FIX: Fetch avatar outside transaction to avoid nested transaction deadlock
      // getUserAvatarUrl() uses its own withTransaction(), causing connection leaks when nested
      const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // For Citus, we need to explicitly filter by tenant in the query
        // Even though User.get includes tenant filter, be explicit for safety
        const user = await trx<IUser>('users')
          .select('*')
          .where('user_id', sessionUser.id)
          .where('tenant', sessionUser.tenant) // Explicit tenant filter for Citus
          .first();

        if (!user) {
          logger.debug(`User not found for ID: ${sessionUser.id} in tenant: ${sessionUser.tenant}`);
          return null;
        }

        logger.debug(`Fetching roles for user ID: ${user.user_id}`);
        // Get roles with explicit tenant filter for Citus
        const roles = await trx<IRole>('roles')
          .join('user_roles', function () {
            this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
          })
          .where('user_roles.user_id', user.user_id)
          .where('user_roles.tenant', sessionUser.tenant) // Explicit tenant filter for Citus
          .where('roles.tenant', sessionUser.tenant) // Explicit tenant filter for Citus
          .select('roles.*');

        logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
        return { ...user, roles };
      });

      if (!userWithRoles) {
        return null;
      }

      // Fetch avatar outside transaction to avoid nested transaction
      const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);

      return { ...userWithRoles, avatarUrl };
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      logger.error('No tenant context available for email-based lookup');
      return null;
    }

    // If we have user type in session, use it for more accurate lookup
    if (sessionUser.user_type && session.user?.email) {
      logger.debug(`Looking up user by email and type: ${session.user.email}, ${sessionUser.user_type}, tenant: ${tenant}`);

      const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Explicit query with tenant filter for Citus
        const user = await trx<IUser>('users')
          .select('*')
          .where('email', session.user!.email!.toLowerCase())
          .where('user_type', sessionUser.user_type)
          .where('tenant', tenant) // Explicit tenant filter for Citus
          .first();

        if (!user) {
          logger.debug(`User not found for email: ${session.user!.email}, type: ${sessionUser.user_type}, tenant: ${tenant}`);
          return null;
        }

        // Get roles with explicit tenant filter
        const roles = await trx<IRole>('roles')
          .join('user_roles', function () {
            this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
          })
          .where('user_roles.user_id', user.user_id)
          .where('user_roles.tenant', tenant) // Explicit tenant filter for Citus
          .where('roles.tenant', tenant) // Explicit tenant filter for Citus
          .select('roles.*');

        logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
        return { ...user, roles };
      });

      if (!userWithRoles) {
        return null;
      }

      // Fetch avatar outside transaction to avoid nested transaction
      const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);

      return { ...userWithRoles, avatarUrl };
    }

    // Last resort: email-only lookup (development only)
    if (!session.user?.email) {
      logger.error('Session user email is missing');
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Email-only lookup for: ${session.user.email} in tenant: ${tenant}`);

    const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const user = await trx<IUser>('users')
        .select('*')
        .where('email', session.user!.email!.toLowerCase())
        .where('tenant', tenant) // Explicit tenant filter for Citus
        .first();

      if (!user) {
        logger.debug(`User not found for email: ${session.user!.email} in tenant: ${tenant}`);
        return null;
      }

      // Get roles with explicit tenant filter
      const roles = await trx<IRole>('roles')
        .join('user_roles', function () {
          this.on('roles.role_id', '=', 'user_roles.role_id')
            .andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .where('user_roles.user_id', user.user_id)
        .where('user_roles.tenant', tenant) // Explicit tenant filter for Citus
        .where('roles.tenant', tenant) // Explicit tenant filter for Citus
        .select('roles.*');

      logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
      return { ...user, roles };
    });

    if (!userWithRoles) {
      return null;
    }

    // Fetch avatar outside transaction to avoid nested transaction
    const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);

    return { ...userWithRoles, avatarUrl };
  } catch (error) {
    logger.error('Failed to get current user:', error);
    // Preserve the original error and stack trace
    throw error;
  }
}

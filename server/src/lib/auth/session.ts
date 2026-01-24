import { Knex } from 'knex';
import type { IUser, IRole, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { getSession } from 'server/src/lib/auth/getSession';
import { getUserAvatarUrl } from 'server/src/lib/utils/avatarUtils';
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

    const sessionUser = session.user as any;
    if (sessionUser.id && sessionUser.tenant) {
      logger.debug(`Using user ID from session: ${sessionUser.id}, tenant: ${sessionUser.tenant}`);

      return runWithTenant(sessionUser.tenant, async () => {
        const { knex, tenant } = await createTenantKnex();

        if (tenant && tenant !== sessionUser.tenant) {
          logger.error(`Tenant mismatch: session has ${sessionUser.tenant} but context has ${tenant}`);
          throw new Error('Tenant context mismatch');
        }

        const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const user = await trx<IUser>('users')
            .select('*')
            .where('user_id', sessionUser.id)
            .where('tenant', sessionUser.tenant)
            .first();

          if (!user) {
            logger.debug(`User not found for ID: ${sessionUser.id} in tenant: ${sessionUser.tenant}`);
            return null;
          }

          logger.debug(`Fetching roles for user ID: ${user.user_id}`);
          const roles = await trx<IRole>('roles')
            .join('user_roles', function () {
              this.on('roles.role_id', '=', 'user_roles.role_id')
                .andOn('roles.tenant', '=', 'user_roles.tenant');
            })
            .where('user_roles.user_id', user.user_id)
            .where('user_roles.tenant', sessionUser.tenant)
            .where('roles.tenant', sessionUser.tenant)
            .select('roles.*');

          logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
          return { ...user, roles };
        });

        if (!userWithRoles) {
          return null;
        }

        const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);
        return { ...userWithRoles, avatarUrl };
      });
    }

    if (process.env.NODE_ENV === 'production') {
      logger.error('Session missing user ID or tenant - cannot safely retrieve user in production');
      return null;
    }

    if (!session.user.email) {
      logger.debug('No user email found in session');
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Falling back to email lookup for: ${session.user.email} - this is unsafe in production`);

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      logger.error('No tenant context available for email-based lookup');
      return null;
    }

    if (sessionUser.user_type && session.user?.email) {
      logger.debug(`Looking up user by email and type: ${session.user.email}, ${sessionUser.user_type}, tenant: ${tenant}`);

      const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const user = await trx<IUser>('users')
          .select('*')
          .where('email', session.user!.email!.toLowerCase())
          .where('user_type', sessionUser.user_type)
          .where('tenant', tenant)
          .first();

        if (!user) {
          logger.debug(`User not found for email: ${session.user!.email}, type: ${sessionUser.user_type}, tenant: ${tenant}`);
          return null;
        }

        const roles = await trx<IRole>('roles')
          .join('user_roles', function () {
            this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
          })
          .where('user_roles.user_id', user.user_id)
          .where('user_roles.tenant', tenant)
          .where('roles.tenant', tenant)
          .select('roles.*');

        logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
        return { ...user, roles };
      });

      if (!userWithRoles) {
        return null;
      }

      const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);

      return { ...userWithRoles, avatarUrl };
    }

    if (!session.user?.email) {
      logger.error('Session user email is missing');
      return null;
    }

    logger.warn(`DEVELOPMENT ONLY: Email-only lookup for: ${session.user.email} in tenant: ${tenant}`);

    const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const user = await trx<IUser>('users')
        .select('*')
        .where('email', session.user!.email!.toLowerCase())
        .where('tenant', tenant)
        .first();

      if (!user) {
        logger.debug(`User not found for email: ${session.user!.email} in tenant: ${tenant}`);
        return null;
      }

      const roles = await trx<IRole>('roles')
        .join('user_roles', function () {
          this.on('roles.role_id', '=', 'user_roles.role_id')
            .andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .where('user_roles.user_id', user.user_id)
        .where('user_roles.tenant', tenant)
        .where('roles.tenant', tenant)
        .select('roles.*');

      logger.debug(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
      return { ...user, roles };
    });

    if (!userWithRoles) {
      return null;
    }

    const avatarUrl = await getUserAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);

    return { ...userWithRoles, avatarUrl };
  } catch (error) {
    logger.error('Failed to get current user:', error);
    throw error;
  }
}

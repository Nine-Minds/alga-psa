'use server';

import type { Knex } from 'knex';
import type { IUser, IRole, IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex } from './tenant';
import { withTransaction } from './tenant';
import { tenantDb } from './tenantDb';

/**
 * Session-independent function to get a user with their roles.
 * This can be called from any package without creating circular dependencies.
 *
 * @param userId - The user ID to fetch
 * @param tenantId - The tenant ID for the user
 * @param getAvatarUrl - Optional function to get avatar URL (to avoid media dependency)
 * @returns The user with roles, or null if not found
 */
export async function getUserWithRoles(
  userId: string,
  tenantId: string,
  getAvatarUrl?: (userId: string, tenant: string) => Promise<string | null>
): Promise<IUserWithRoles | null> {
  const { knex, tenant } = await createTenantKnex(tenantId);

  // Verify tenant matches for security
  if (tenant && tenant !== tenantId) {
    console.error(`[getUserWithRoles] Tenant mismatch: requested ${tenantId} but context has ${tenant}`);
    throw new Error('Tenant context mismatch');
  }

  const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenantId);

    const user = await scopedDb.table<IUser>('users')
      .select('*')
      .where('user_id', userId)
      .first();

    if (!user) {
      return null;
    }

    const rolesBase = scopedDb.table<IRole>('roles');
    const roles = await scopedDb.tenantJoin(
      rolesBase,
      'user_roles',
      'roles.role_id',
      'user_roles.role_id'
    )
      .where('user_roles.user_id', user.user_id)
      .select('roles.*');

    // Look up clientId from contacts table if user has a contact_id
    let clientId: string | undefined;
    if (user.contact_id) {
      const contact = await scopedDb.table('contacts')
        .select('client_id')
        .where('contact_name_id', user.contact_id)
        .first();
      if (contact?.client_id) {
        clientId = contact.client_id;
      }
    }

    return { ...user, roles, clientId };
  });

  if (!userWithRoles) {
    return null;
  }

  // Fetch avatar if getter function provided
  if (getAvatarUrl) {
    const avatarUrl = await getAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);
    return { ...userWithRoles, avatarUrl };
  }

  return userWithRoles;
}

/**
 * Get a user with roles by email and optional user type.
 * This is a fallback method for development when session doesn't have user ID.
 */
export async function getUserWithRolesByEmail(
  email: string,
  tenantId: string,
  userType?: string,
  getAvatarUrl?: (userId: string, tenant: string) => Promise<string | null>
): Promise<IUserWithRoles | null> {
  const { knex } = await createTenantKnex(tenantId);

  const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenantId);

    let query = scopedDb.table<IUser>('users')
      .select('*')
      .where('email', email.toLowerCase());

    if (userType) {
      query = query.where('user_type', userType);
    }

    const user = await query.first();

    if (!user) {
      return null;
    }

    const rolesBase = scopedDb.table<IRole>('roles');
    const roles = await scopedDb.tenantJoin(
      rolesBase,
      'user_roles',
      'roles.role_id',
      'user_roles.role_id'
    )
      .where('user_roles.user_id', user.user_id)
      .select('roles.*');

    // Look up clientId from contacts table if user has a contact_id
    let clientId: string | undefined;
    if (user.contact_id) {
      const contact = await scopedDb.table('contacts')
        .select('client_id')
        .where('contact_name_id', user.contact_id)
        .first();
      if (contact?.client_id) {
        clientId = contact.client_id;
      }
    }

    return { ...user, roles, clientId };
  });

  if (!userWithRoles) {
    return null;
  }

  if (getAvatarUrl) {
    const avatarUrl = await getAvatarUrl(userWithRoles.user_id, userWithRoles.tenant);
    return { ...userWithRoles, avatarUrl };
  }

  return userWithRoles;
}

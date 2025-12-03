import { Knex } from 'knex';
import logger from '@alga-psa/shared/core/logger';
import { IUser, IRole, IUserRole, IUserWithRoles, IRoleWithPermissions, IPermission } from 'server/src/interfaces/auth.interfaces';
import { getConnection } from 'server/src/lib/db/db';
import { getAdminConnection } from '@shared/db/admin';
import { getCurrentTenantId } from 'server/src/lib/db';
import { hashPassword, verifyPassword } from 'server/src/utils/encryption/encryption';

// Update the IUserRole interface to make tenant optional and allow null
interface IUserRoleWithOptionalTenant extends Omit<IUserRole, 'tenant'> {
  user_id: string;
  role_id: string;
  tenant?: string | null;
}

const User = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeInactive: boolean = false): Promise<IUser[]> => {
    const tenant = await getCurrentTenantId();
    try {
      let query = knexOrTrx<IUser>('users').select('*');
      query = query.andWhere('tenant', tenant);
      if (!includeInactive) {
        query = query.andWhere('is_inactive', false);
      }
      query = query.orderBy([
        { column: 'first_name', order: 'asc' },
        { column: 'last_name', order: 'asc' }
      ]);
      
      const users = await query;
      return users;
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  },

  findUserByEmail: async (email: string): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users').select('*').where({ email: email.toLowerCase() }).first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with email ${email}:`, error);
      throw error;
    }
  },

  // Find a user by email and user_type (e.g., 'internal' vs 'client').
  // Email is normalized to lowercase to avoid case-sensitivity issues.
  findUserByEmailAndType: async (email: string, userType: 'internal' | 'client'): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users')
        .select('*')
        .where({ email: email.toLowerCase(), user_type: userType })
        .first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with email ${email} and type ${userType}:`, error);
      throw error;
    }
  },

  findUserByEmailTenantAndType: async (
    email: string,
    tenantId: string,
    userType: 'internal' | 'client'
  ): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users')
        .select('*')
        .where({
          email: email.toLowerCase(),
          user_type: userType,
          tenant: tenantId,
        })
        .first();
      return user;
    } catch (error) {
      logger.error(
        `Error finding user with email ${email}, tenant ${tenantId}, and type ${userType}:`,
        error
      );
      throw error;
    }
  },

  findUserByUsername: async (knexOrTrx: Knex | Knex.Transaction, username: string): Promise<IUser | undefined> => {
    const tenant = await getCurrentTenantId();
    try {
      const user = await knexOrTrx<IUser>('users')
        .select('*')
        .where('username', username.toLowerCase())
        .andWhere('tenant', tenant)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with username ${username}:`, error);
      throw error;
    }
  },

  findOldestUser: async (knexOrTrx: Knex | Knex.Transaction): Promise<IUser | undefined> => {
    const tenant = await getCurrentTenantId();
    try {
      const oldestUser = await knexOrTrx<IUser>('users')
        .select('*')
        .where('tenant', tenant)
        .orderBy('created_at', 'asc')
        .first();
      return oldestUser;
    } catch (error) {
      logger.error('Error finding oldest user:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IUser | undefined> => {
    const tenant = await getCurrentTenantId();
    try {
      const user = await knexOrTrx<IUser>('users')
        .select('*')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error getting user with id ${user_id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, user: Omit<IUserWithRoles, 'tenant'>): Promise<Pick<IUserWithRoles, "user_id">> => {
    const tenant = await getCurrentTenantId();
    try {
      logger.info('Inserting user:', user);
      const { roles, ...userData } = user;

      if (!roles || roles.length === 0) {
        throw new Error('User must have at least one role');
      }

      return await knexOrTrx.transaction(async (trx) => {
        const [insertedUser] = await trx<IUser>('users').insert({
          ...userData,
          is_inactive: false,
          tenant: tenant || undefined
        }).returning('user_id');

        const userRoles = roles.map((role: IRole): IUserRoleWithOptionalTenant => {
          if (!role.role_id) {
            throw new Error('Invalid role: role_id is missing');
          }
          return { user_id: insertedUser.user_id, role_id: role.role_id, tenant: tenant || undefined };
        });

        await trx('user_roles').insert(userRoles);

        return insertedUser;
      });
    } catch (error) {
      logger.error('Error inserting user:', error);
      throw error;
    }
  },

  getUserWithRoles: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IUserWithRoles | undefined> => {
    const tenant = await getCurrentTenantId();
    try {
      const user = await knexOrTrx<IUser>('users')
        .select('*')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .first();
      if (user) {
        const roles = await User.getUserRoles(knexOrTrx, user_id);
        return { ...user, roles };
      }
      return undefined;
    } catch (error) {
      logger.error(`Error getting user with roles for id ${user_id}:`, error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, user_id: string, user: Partial<IUser>): Promise<void> => {
    const tenant = await getCurrentTenantId();
    try {
      await knexOrTrx<IUser>('users')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .update(user);
    } catch (error) {
      logger.error(`Error updating user with id ${user_id}:`, error);
      throw error;
    }
  },

  updatePassword: async (email: string, hashed_password: string): Promise<void> => {
    const db = await getAdminConnection();
    try {
      await db<IUser>('users').where({ email: email.toLowerCase() }).update({ hashed_password });
      logger.system(`Password updated for user with email ${email}`);
    } catch (error) {
      logger.error(`Error updating password for user with email ${email}:`, error);
      throw error;
    }
  },

  verifyPassword: async (user_id: string, password: string): Promise<boolean> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users')
        .select('hashed_password')
        .where({ user_id })
        .first();

      if (!user) {
        return false;
      }

      return verifyPassword(password, user.hashed_password);
    } catch (error) {
      logger.error(`Error verifying password for user ${user_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<void> => {
    const tenant = await getCurrentTenantId();
    try {
      await knexOrTrx<IUser>('users')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      logger.error(`Error deleting user with id ${user_id}:`, error);
      throw error;
    }
  },

  getMultiple: async (knexOrTrx: Knex | Knex.Transaction, userIds: string[]): Promise<IUser[]> => {
    const tenant = await getCurrentTenantId();
    try {
      const users = await knexOrTrx<IUser>('users')
        .select('*')
        .where('tenant', tenant)
        .whereIn('user_id', userIds);
      return users;
    } catch (error) {
      logger.error('Error getting multiple users:', error);
      throw error;
    }
  },

  getUserRoles: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IRole[]> => {
    const tenant = await getCurrentTenantId();
    try {
      const query = knexOrTrx<IRole>('roles')
        .join('user_roles', function() {
          this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .where('user_roles.user_id', user_id)
        .where('roles.tenant', tenant);

      const roles = await query.select('*');

      return roles;
    } catch (error) {
      logger.error(`Error getting roles for user with id ${user_id}:`, error);
      throw error;
    }
  },

  /**
   * Fetch roles for multiple users in a single query (avoids N+1)
   * Returns a Map of user_id -> IRole[]
   */
  getUserRolesBulk: async (knexOrTrx: Knex | Knex.Transaction, userIds: string[]): Promise<Map<string, IRole[]>> => {
    const tenant = await getCurrentTenantId();
    const rolesByUser = new Map<string, IRole[]>();

    if (userIds.length === 0) {
      return rolesByUser;
    }

    try {
      const rows = await knexOrTrx('roles')
        .join('user_roles', function() {
          this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .whereIn('user_roles.user_id', userIds)
        .where('roles.tenant', tenant)
        .select(
          'user_roles.user_id',
          'roles.role_id',
          'roles.role_name',
          'roles.description',
          'roles.tenant',
          'roles.msp',
          'roles.client'
        );

      // Group roles by user_id
      for (const row of rows) {
        const userId = row.user_id;
        const role: IRole = {
          role_id: row.role_id,
          role_name: row.role_name,
          description: row.description,
          tenant: row.tenant,
          msp: row.msp,
          client: row.client,
        };

        if (!rolesByUser.has(userId)) {
          rolesByUser.set(userId, []);
        }
        rolesByUser.get(userId)!.push(role);
      }

      // Ensure all requested users have an entry (even if empty)
      for (const userId of userIds) {
        if (!rolesByUser.has(userId)) {
          rolesByUser.set(userId, []);
        }
      }

      return rolesByUser;
    } catch (error) {
      logger.error('Error getting roles for multiple users:', error);
      throw error;
    }
  },

  getUserRolesWithPermissions: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IRoleWithPermissions[]> => {
    const tenant = await getCurrentTenantId();
    try {
      let query = knexOrTrx<IRole>('roles')
        .join('user_roles', function() {
          this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant')
              .andOn('user_roles.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .where('user_roles.user_id', user_id)
        .andWhere('roles.tenant', tenant);
      
      const roles = await query.select([
        'roles.role_id',
        'roles.role_name',
        'roles.description',
        'roles.tenant',
        'roles.msp',
        'roles.client'
      ]);

      const rolesWithPermissions = await Promise.all(roles.map(async (role): Promise<IRoleWithPermissions> => {
        let permissionQuery = knexOrTrx<IPermission>('permissions')
          .join('role_permissions', function() {
            this.on('permissions.permission_id', '=', 'role_permissions.permission_id')
                .andOn('permissions.tenant', '=', 'role_permissions.tenant')
                .andOn('role_permissions.tenant', '=', knexOrTrx.raw('?', [tenant]));
          })
          .where('role_permissions.role_id', role.role_id)
          .andWhere('permissions.tenant', tenant);
        
        const permissions = await permissionQuery.select([
          'permissions.permission_id',
          'permissions.resource',
          'permissions.action',
          'permissions.tenant',
          'permissions.msp',
          'permissions.client'
        ]);

        return {
          ...role,
          permissions,
        };
      }));

      return rolesWithPermissions;
    } catch (error) {
      logger.error(`Error getting roles with permissions for user with id ${user_id}:`, error);
      throw error;
    }
  },

  updateUserRoles: async (knexOrTrx: Knex | Knex.Transaction, user_id: string, roles: IRole[]): Promise<void> => {
    const tenant = await getCurrentTenantId();
    try {
      await knexOrTrx('user_roles').where({ user_id, tenant }).del();
      const userRoles = roles.map((role): IUserRoleWithOptionalTenant => ({
        user_id,
        role_id: role.role_id,
        tenant
      }));
      await knexOrTrx('user_roles').insert(userRoles);
    } catch (error) {
      logger.error(`Error updating roles for user with id ${user_id}:`, error);
      throw error;
    }
  },

  // Special method for getting user during registration process
  getForRegistration: async (user_id: string): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users')
        .select('*')
        .where('user_id', user_id)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error getting user for registration with id ${user_id}:`, error);
      throw error;
    }
  },

  // Update last login information
  updateLastLogin: async (userId: string, tenant: string, loginMethod: string): Promise<void> => {
    const db = await getAdminConnection();
    try {
      await db<IUser>('users')
        .where('user_id', userId)
        .andWhere('tenant', tenant)
        .update({
          last_login_at: db.fn.now(),
          last_login_method: loginMethod
        });
      logger.debug(`Updated last login for user ${userId}`);
    } catch (error) {
      logger.error(`Error updating last login for user ${userId}:`, error);
      // Don't throw - login should succeed even if tracking fails
    }
  },
};

export default User;

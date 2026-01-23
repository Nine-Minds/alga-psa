import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type {
  IUser,
  IRole,
  IUserRole,
  IUserWithRoles,
  IRoleWithPermissions,
  IPermission,
} from '@alga-psa/types';
import { getAdminConnection } from '../lib/admin';
import { requireTenantId } from '../lib/tenantId';
import { verifyPassword } from '@alga-psa/core/encryption';

interface IUserRoleWithOptionalTenant extends Omit<IUserRole, 'tenant'> {
  user_id: string;
  role_id: string;
  tenant?: string | null;
}

const User = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeInactive = false): Promise<IUser[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      let query = knexOrTrx<IUser>('users').select('*');
      query = query.andWhere('tenant', tenant);
      if (!includeInactive) {
        query = query.andWhere('is_inactive', false);
      }
      query = query.orderBy([
        { column: 'first_name', order: 'asc' },
        { column: 'last_name', order: 'asc' },
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
      logger.error(`Error finding user with email ${email}, tenant ${tenantId}, and type ${userType}:`, error);
      throw error;
    }
  },

  findUserByUsername: async (knexOrTrx: Knex | Knex.Transaction, username: string): Promise<IUser | undefined> => {
    const tenant = await requireTenantId(knexOrTrx);
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
    const tenant = await requireTenantId(knexOrTrx);
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
    const tenant = await requireTenantId(knexOrTrx);
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

  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    user: Omit<IUserWithRoles, 'tenant'>
  ): Promise<Pick<IUserWithRoles, 'user_id'>> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      logger.info('Inserting user:', user);
      const { roles, ...userData } = user;

      if (!roles || roles.length === 0) {
        throw new Error('User must have at least one role');
      }

      return await knexOrTrx.transaction(async (trx) => {
        const [insertedUser] = await trx<IUser>('users')
          .insert({
            ...userData,
            is_inactive: false,
            tenant,
          })
          .returning('user_id');

        const userRoles = roles.map((role: IRole): IUserRoleWithOptionalTenant => {
          if (!role.role_id) {
            throw new Error('Invalid role: role_id is missing');
          }
          return { user_id: insertedUser.user_id, role_id: role.role_id, tenant };
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
    const tenant = await requireTenantId(knexOrTrx);
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
    const tenant = await requireTenantId(knexOrTrx);
    try {
      await knexOrTrx<IUser>('users').where('user_id', user_id).andWhere('tenant', tenant).update(user);
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
      const user = await db<IUser>('users').select('hashed_password').where({ user_id }).first();
      if (!user?.hashed_password) {
        return false;
      }
      return verifyPassword(password, user.hashed_password);
    } catch (error) {
      logger.error(`Error verifying password for user ${user_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      await knexOrTrx<IUser>('users').where('user_id', user_id).andWhere('tenant', tenant).del();
    } catch (error) {
      logger.error(`Error deleting user with id ${user_id}:`, error);
      throw error;
    }
  },

  getMultiple: async (knexOrTrx: Knex | Knex.Transaction, userIds: string[]): Promise<IUser[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      const users = await knexOrTrx<IUser>('users').select('*').where('tenant', tenant).whereIn('user_id', userIds);
      return users;
    } catch (error) {
      logger.error('Error getting multiple users:', error);
      throw error;
    }
  },

  getUserRoles: async (knexOrTrx: Knex | Knex.Transaction, user_id: string): Promise<IRole[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      const query = knexOrTrx<IRole>('roles')
        .join('user_roles', function () {
          this.on('roles.role_id', '=', 'user_roles.role_id').andOn('roles.tenant', '=', 'user_roles.tenant');
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

  getUserRolesBulk: async (knexOrTrx: Knex | Knex.Transaction, userIds: string[]): Promise<Map<string, IRole[]>> => {
    const tenant = await requireTenantId(knexOrTrx);
    const rolesByUser = new Map<string, IRole[]>();

    if (userIds.length === 0) {
      return rolesByUser;
    }

    try {
      const rows = await knexOrTrx('roles')
        .join('user_roles', function () {
          this.on('roles.role_id', '=', 'user_roles.role_id').andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .whereIn('user_roles.user_id', userIds)
        .where('roles.tenant', tenant)
        .select('user_roles.user_id', 'roles.role_id', 'roles.role_name', 'roles.description', 'roles.tenant', 'roles.msp', 'roles.client');

      for (const row of rows as any[]) {
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

  getUserRolesWithPermissions: async (
    knexOrTrx: Knex | Knex.Transaction,
    user_id: string
  ): Promise<IRoleWithPermissions[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      const query = knexOrTrx<IRole>('roles')
        .join('user_roles', function () {
          this.on('roles.role_id', '=', 'user_roles.role_id')
            .andOn('roles.tenant', '=', 'user_roles.tenant')
            .andOn('user_roles.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .where('user_roles.user_id', user_id)
        .andWhere('roles.tenant', tenant);

      const roles = await query.select(['roles.role_id', 'roles.role_name', 'roles.description', 'roles.tenant', 'roles.msp', 'roles.client']);

      const rolesWithPermissions = await Promise.all(
        roles.map(async (role: any): Promise<IRoleWithPermissions> => {
          const permissionQuery = knexOrTrx<IPermission>('permissions')
            .join('role_permissions', function () {
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
            'permissions.client',
          ]);

          return { ...role, permissions };
        })
      );

      return rolesWithPermissions;
    } catch (error) {
      logger.error(`Error getting roles with permissions for user with id ${user_id}:`, error);
      throw error;
    }
  },

  updateUserRoles: async (knexOrTrx: Knex | Knex.Transaction, user_id: string, roles: IRole[]): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      await knexOrTrx('user_roles').where({ user_id, tenant }).del();
      const userRoles = roles.map((role): IUserRoleWithOptionalTenant => ({
        user_id,
        role_id: role.role_id,
        tenant,
      }));
      await knexOrTrx('user_roles').insert(userRoles);
    } catch (error) {
      logger.error(`Error updating roles for user with id ${user_id}:`, error);
      throw error;
    }
  },

  getForRegistration: async (user_id: string): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await db<IUser>('users').select('*').where('user_id', user_id).first();
      return user;
    } catch (error) {
      logger.error(`Error getting user for registration with id ${user_id}:`, error);
      throw error;
    }
  },

  updateLastLogin: async (userId: string, tenant: string, loginMethod: string): Promise<void> => {
    const db = await getAdminConnection();
    try {
      const updated = await db<IUser>('users')
        .where('user_id', userId)
        .andWhere('tenant', tenant)
        .update({
          last_login_at: db.fn.now(),
          last_login_method: loginMethod,
        });
      if (Number(updated) > 0) {
        logger.debug(`Updated last login for user ${userId}`);
      } else {
        logger.warn('Last login update skipped: user not found', { userId, tenant, loginMethod });
      }
    } catch (error) {
      logger.error(`Error updating last login for user ${userId}:`, error);
    }
  },
};

export default User;


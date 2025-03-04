import logger from '@shared/core/logger';
import { IUser, IRole, IUserRole, IUserWithRoles, IRoleWithPermissions, IPermission } from 'server/src/interfaces/auth.interfaces';
import { getConnection } from 'server/src/lib/db/db';
import { getAdminConnection } from 'server/src/lib/db/admin';
import { createTenantKnex } from 'server/src/lib/db';
import { hashPassword, verifyPassword } from 'server/src/utils/encryption/encryption';

// Update the IUserRole interface to make tenant optional and allow null
interface IUserRoleWithOptionalTenant extends Omit<IUserRole, 'tenant'> {
  user_id: string;
  role_id: string;
  tenant?: string | null;
}

const User = {
  getAll: async (includeInactive: boolean = false): Promise<IUser[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      let query = db<IUser>('users').select('*');
      query = query.andWhere('tenant', tenant);
      if (!includeInactive) {
        query = query.andWhere('is_inactive', false);
      }
      
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
      const user = await db<IUser>('users').select('*').where({ email }).first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with email ${email}:`, error);
      throw error;
    }
  },

  findUserByUsername: async (username: string): Promise<IUser | undefined> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const user = await db<IUser>('users')
        .select('*')
        .where('username', username)
        .andWhere('tenant', tenant)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with username ${username}:`, error);
      throw error;
    }
  },

  findOldestUser: async (): Promise<IUser | undefined> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const oldestUser = await db<IUser>('users')
        .select('*')
        .where('tenant', tenant)
        .orderBy('created_at', 'asc')
        .first();
      console.log('oldest user ', oldestUser);
      return oldestUser;
    } catch (error) {
      logger.error('Error finding oldest user:', error);
      throw error;
    }
  },

  get: async (user_id: string): Promise<IUser | undefined> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const user = await db<IUser>('users')
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

  insert: async (user: Omit<IUserWithRoles, 'tenant'>): Promise<Pick<IUserWithRoles, "user_id">> => {
    const { knex: db, tenant } = await createTenantKnex();
    try {
      logger.info('Inserting user:', user);
      const { roles, ...userData } = user;

      if (!roles || roles.length === 0) {
        throw new Error('User must have at least one role');
      }

      return await db.transaction(async (trx) => {
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

  getUserWithRoles: async (user_id: string): Promise<IUserWithRoles | undefined> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const user = await db<IUser>('users')
        .select('*')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .first();
      if (user) {
        const roles = await User.getUserRoles(user_id);
        return { ...user, roles };
      }
      return undefined;
    } catch (error) {
      logger.error(`Error getting user with roles for id ${user_id}:`, error);
      throw error;
    }
  },

  update: async (user_id: string, user: Partial<IUser>): Promise<void> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      await db<IUser>('users')
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
      await db<IUser>('users').where({ email }).update({ hashed_password });
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

  delete: async (user_id: string): Promise<void> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      await db<IUser>('users')
        .where('user_id', user_id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      logger.error(`Error deleting user with id ${user_id}:`, error);
      throw error;
    }
  },

  getMultiple: async (userIds: string[]): Promise<IUser[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const users = await db<IUser>('users')
        .select('*')
        .where('tenant', tenant)
        .whereIn('user_id', userIds);
      return users;
    } catch (error) {
      logger.error('Error getting multiple users:', error);
      throw error;
    }
  },

  getUserRoles: async (user_id: string): Promise<IRole[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      const query = db<IRole>('roles')
        .join('user_roles', function() {
          this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant');
        })
        .where('user_roles.user_id', user_id)
        .where('roles.tenant', tenant);
      
      const roles = await query.select('roles.*');
      // Convert role names to lowercase for case-insensitive comparison
      return roles.map((role: IRole): IRole => ({
        ...role,
        role_name: role.role_name.toLowerCase()
      }));
    } catch (error) {
      logger.error(`Error getting roles for user with id ${user_id}:`, error);
      throw error;
    }
  },

  getUserRolesWithPermissions: async (user_id: string): Promise<IRoleWithPermissions[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      let query = db<IRole>('roles')
        .join('user_roles', function() {
          this.on('roles.role_id', '=', 'user_roles.role_id')
              .andOn('roles.tenant', '=', 'user_roles.tenant')
              .andOn('user_roles.tenant', '=', db.raw('?', [tenant]));
        })
        .where('user_roles.user_id', user_id)
        .andWhere('roles.tenant', tenant);
      
      const roles = await query.select([
        'roles.role_id',
        'roles.role_name',
        'roles.description',
        'roles.tenant'
      ]);

      const rolesWithPermissions = await Promise.all(roles.map(async (role): Promise<IRoleWithPermissions> => {
        let permissionQuery = db<IPermission>('permissions')
          .join('role_permissions', function() {
            this.on('permissions.permission_id', '=', 'role_permissions.permission_id')
                .andOn('permissions.tenant', '=', 'role_permissions.tenant')
                .andOn('role_permissions.tenant', '=', db.raw('?', [tenant]));
          })
          .where('role_permissions.role_id', role.role_id)
          .andWhere('permissions.tenant', tenant);
        
        const permissions = await permissionQuery.select([
          'permissions.permission_id',
          'permissions.resource',
          'permissions.action',
          'permissions.tenant'
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

  updateUserRoles: async (user_id: string, roles: IRole[]): Promise<void> => {
    const {knex: db, tenant} = await createTenantKnex();
    try {
      await db('user_roles').where({ user_id, tenant }).del();
      const userRoles = roles.map((role): IUserRoleWithOptionalTenant => ({ 
        user_id, 
        role_id: role.role_id, 
        tenant 
      }));
      await db('user_roles').insert(userRoles);
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
};

export default User;

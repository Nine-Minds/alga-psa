import logger from '@/utils/logger';
import { IUser, IRole, IUserRole, IUserWithRoles, IRoleWithPermissions, IPermission } from '@/interfaces/auth.interfaces';
import { getConnection } from '@/lib/db/db';
import { createTenantKnex } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/utils/encryption/encryption';

// Update the IUserRole interface to make tenant optional and allow null
interface IUserRoleWithOptionalTenant extends Omit<IUserRole, 'tenant'> {
  user_id: string;
  role_id: string;
  tenant?: string | null;
}

const User = {
  getAll: async (includeInactive: boolean = false): Promise<IUser[]> => {
    const db = await getConnection();
    try {
      let query = db<IUser>('users').select('*');
      if (!includeInactive) {
        query = query.where({ is_inactive: false });
      }
      const users = await query;
      return users;
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  },

  findUserByEmail: async (email: string): Promise<IUser | undefined> => {
    const db = await getConnection();
    try {
      const user = await db<IUser>('users').select('*').where({ email }).first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with email ${email}:`, error);
      throw error;
    }
  },

  findUserByUsername: async (username: string): Promise<IUser | undefined> => {
    const db = await getConnection();
    try {
      const user = await db<IUser>('users').select('*').where({ username }).first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with username ${username}:`, error);
      throw error;
    }
  },

  findOldestUser: async (): Promise<IUser | undefined> => {
    const db = await getConnection();
    try {
      const oldestUser = await db<IUser>('users')
        .select('*')
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
    const db = await getConnection();
    try {
      const user = await db<IUser>('users').select('*').where({ user_id }).first();
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
      const user = await db<IUser>('users').select('*').where({ user_id }).first();
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
    const db = await getConnection();
    try {
      await db<IUser>('users').where({ user_id }).update(user);
    } catch (error) {
      logger.error(`Error updating user with id ${user_id}:`, error);
      throw error;
    }
  },

  updatePassword: async (email: string, hashed_password: string): Promise<void> => {
    const db = await getConnection();
    try {
      await db<IUser>('users').where({ email }).update({ hashed_password });
      logger.system(`Password updated for user with email ${email}`);
    } catch (error) {
      logger.error(`Error updating password for user with email ${email}:`, error);
      throw error;
    }
  },

  verifyPassword: async (user_id: string, password: string): Promise<boolean> => {
    const db = await getConnection();
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
    const db = await getConnection();
    try {
      await db<IUser>('users').where({ user_id }).del();
    } catch (error) {
      logger.error(`Error deleting user with id ${user_id}:`, error);
      throw error;
    }
  },

  getMultiple: async (userIds: string[]): Promise<IUser[]> => {
    const db = await getConnection();
    try {
      const users = await db<IUser>('users').select('*').whereIn('user_id', userIds);
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
        .join('user_roles', 'roles.role_id', 'user_roles.role_id')
        .where('user_roles.user_id', user_id);
      
      if (tenant !== null) {
        query = query.andWhere('user_roles.tenant', tenant);
      }
      
      const roles = await query.select('roles.*');

      const rolesWithPermissions = await Promise.all(roles.map(async (role): Promise<IRoleWithPermissions> => {
        let permissionQuery = db<IPermission>('permissions')
          .join('role_permissions', 'permissions.permission_id', 'role_permissions.permission_id')
          .where('role_permissions.role_id', role.role_id);
        
        if (tenant !== null) {
          permissionQuery = permissionQuery.andWhere('role_permissions.tenant', tenant);
        }
        
        const permissions = await permissionQuery.select('permissions.*');

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
};

export default User;

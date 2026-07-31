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
import { tenantDb } from '../lib/tenantDb';
import { requireTenantId } from '../lib/tenantId';
import { verifyPassword } from '@alga-psa/core/encryption';

interface IUserRoleWithOptionalTenant extends Omit<IUserRole, 'tenant'> {
  user_id: string;
  role_id: string;
  tenant?: string | null;
}

const USER_MODEL_DISCOVERY_TENANT = '__user_model_discovery__';
const USER_DISCOVERY_BY_EMAIL_REASON = 'user discovery by email before tenant context exists';
const USER_DISCOVERY_BY_EMAIL_AND_TYPE_REASON = 'user discovery by email and type before tenant context exists';
const USER_PASSWORD_VERIFY_REASON = 'password verification by user id before tenant context exists';
const USER_REGISTRATION_LOOKUP_REASON = 'registration lookup by user id before tenant context exists';

const User = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeInactive = false): Promise<IUser[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      let query = tenantDb(knexOrTrx, tenant).table<IUser>('users').select('*');
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
      const user = await tenantDb(db, USER_MODEL_DISCOVERY_TENANT)
        .unscoped<IUser>('users', USER_DISCOVERY_BY_EMAIL_REASON)
        .select('*')
        .where({ email: email.toLowerCase() })
        .first();
      return user;
    } catch (error) {
      logger.error(`Error finding user with email ${email}:`, error);
      throw error;
    }
  },

  findUserByEmailAndType: async (email: string, userType: 'internal' | 'client'): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await tenantDb(db, USER_MODEL_DISCOVERY_TENANT)
        .unscoped<IUser>('users', USER_DISCOVERY_BY_EMAIL_AND_TYPE_REASON)
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
      const user = await tenantDb(db, tenantId).table<IUser>('users')
        .select('*')
        .where({
          email: email.toLowerCase(),
          user_type: userType,
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
      const user = await tenantDb(knexOrTrx, tenant).table<IUser>('users')
        .select('*')
        .where('username', username.toLowerCase())
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
      const oldestUser = await tenantDb(knexOrTrx, tenant).table<IUser>('users')
        .select('*')
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
      const user = await tenantDb(knexOrTrx, tenant).table<IUser>('users')
        .select('*')
        .where('user_id', user_id)
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
        const [insertedUser] = await tenantDb(trx, tenant).table<IUser>('users')
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

        await tenantDb(trx, tenant).table('user_roles').insert(userRoles);

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
      const user = await tenantDb(knexOrTrx, tenant).table<IUser>('users')
        .select('*')
        .where('user_id', user_id)
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
      await tenantDb(knexOrTrx, tenant).table<IUser>('users').where('user_id', user_id).update(user);
    } catch (error) {
      logger.error(`Error updating user with id ${user_id}:`, error);
      throw error;
    }
  },

  isInReportsToChain: async (
    knexOrTrx: Knex | Knex.Transaction,
    managerUserId: string,
    employeeUserId: string
  ): Promise<boolean> => {
    const tenant = await requireTenantId(knexOrTrx);
    const db = tenantDb(knexOrTrx, tenant);
    const chainRoot = db.table('users as u')
      .select('u.reports_to')
      .where('u.user_id', employeeUserId)
      .toSQL();
    const chainStep = db.table('users as u2')
      .select('u2.reports_to')
      .join('chain as c', 'u2.user_id', 'c.reports_to')
      .whereNotNull('c.reports_to')
      .toSQL();

    const { rows } = await knexOrTrx.raw(
      `
        WITH RECURSIVE chain AS (
          ${chainRoot.sql}
          UNION ALL
          ${chainStep.sql}
        )
        SELECT 1
        FROM chain
        WHERE reports_to = ?
        LIMIT 1
      `,
      [
        ...(chainRoot.bindings ?? []),
        ...(chainStep.bindings ?? []),
        managerUserId,
      ]
    );

    return rows.length > 0;
  },

  getReportsToSubordinateIds: async (
    knexOrTrx: Knex | Knex.Transaction,
    managerUserId: string
  ): Promise<string[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    const db = tenantDb(knexOrTrx, tenant);
    const subordinateRoot = db.table('users as u')
      .select('u.user_id', knexOrTrx.raw('1 AS depth'))
      .where('u.reports_to', managerUserId)
      .toSQL();
    const subordinateStep = db.table('users as u2')
      .select('u2.user_id', knexOrTrx.raw('rtc.depth + 1 AS depth'))
      .join('reports_to_chain as rtc', 'u2.reports_to', 'rtc.user_id')
      .where('rtc.depth', '<', 20)
      .toSQL();

    const { rows } = await knexOrTrx.raw(
      `
        WITH RECURSIVE reports_to_chain AS (
          ${subordinateRoot.sql}
          UNION ALL
          ${subordinateStep.sql}
        )
        SELECT user_id FROM reports_to_chain
      `,
      [
        ...(subordinateRoot.bindings ?? []),
        ...(subordinateStep.bindings ?? []),
      ]
    );
    return rows.map((row: { user_id: string }) => row.user_id);
  },

  updatePassword: async (user_id: string, tenant: string, hashed_password: string): Promise<void> => {
    const db = await getAdminConnection();
    try {
      await tenantDb(db, tenant).table<IUser>('users').where({ user_id }).update({ hashed_password });
      logger.system(`Password updated for user ${user_id} in tenant ${tenant}`);
    } catch (error) {
      logger.error(`Error updating password for user ${user_id} in tenant ${tenant}:`, error);
      throw error;
    }
  },

  verifyPassword: async (user_id: string, password: string): Promise<boolean> => {
    const db = await getAdminConnection();
    try {
      const user = await tenantDb(db, USER_MODEL_DISCOVERY_TENANT)
        .unscoped<IUser>('users', USER_PASSWORD_VERIFY_REASON)
        .select('hashed_password')
        .where({ user_id })
        .first();
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
      await tenantDb(knexOrTrx, tenant).table<IUser>('users').where('user_id', user_id).del();
    } catch (error) {
      logger.error(`Error deleting user with id ${user_id}:`, error);
      throw error;
    }
  },

  getMultiple: async (knexOrTrx: Knex | Knex.Transaction, userIds: string[]): Promise<IUser[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      const users = await tenantDb(knexOrTrx, tenant).table<IUser>('users').select('*').whereIn('user_id', userIds);
      return users;
    } catch (error) {
      logger.error('Error getting multiple users:', error);
      throw error;
    }
  },

  getUserRoles: async (
    knexOrTrx: Knex | Knex.Transaction,
    user_id: string,
    tenantOverride?: string
  ): Promise<IRole[]> => {
    const tenant = tenantOverride ?? (await requireTenantId(knexOrTrx));
    try {
      const db = tenantDb(knexOrTrx, tenant);
      const query = db.table<IRole>('roles').where('user_roles.user_id', user_id);
      db.tenantJoin(query, 'user_roles', 'roles.role_id', 'user_roles.role_id');

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
      const db = tenantDb(knexOrTrx, tenant);
      const query = db.table('roles')
        .whereIn('user_roles.user_id', userIds)
        .select('user_roles.user_id', 'roles.role_id', 'roles.role_name', 'roles.description', 'roles.tenant', 'roles.msp', 'roles.client');
      db.tenantJoin(query, 'user_roles', 'roles.role_id', 'user_roles.role_id');
      const rows = await query;

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
      const db = tenantDb(knexOrTrx, tenant);
      const query = db.table<IRole>('roles')
        .where('user_roles.user_id', user_id);
      db.tenantJoin(query, 'user_roles', 'roles.role_id', 'user_roles.role_id');

      const roles = await query.select(['roles.role_id', 'roles.role_name', 'roles.description', 'roles.tenant', 'roles.msp', 'roles.client']);

      const rolesWithPermissions = await Promise.all(
        roles.map(async (role: any): Promise<IRoleWithPermissions> => {
          const permissionQuery = db.table<IPermission>('permissions')
            .where('role_permissions.role_id', role.role_id);
          db.tenantJoin(permissionQuery, 'role_permissions', 'permissions.permission_id', 'role_permissions.permission_id');

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
      const db = tenantDb(knexOrTrx, tenant);
      await db.table('user_roles').where({ user_id }).del();
      const userRoles = roles.map((role): IUserRoleWithOptionalTenant => ({
        user_id,
        role_id: role.role_id,
        tenant,
      }));
      await db.table('user_roles').insert(userRoles);
    } catch (error) {
      logger.error(`Error updating roles for user with id ${user_id}:`, error);
      throw error;
    }
  },

  getForRegistration: async (user_id: string): Promise<IUser | undefined> => {
    const db = await getAdminConnection();
    try {
      const user = await tenantDb(db, USER_MODEL_DISCOVERY_TENANT)
        .unscoped<IUser>('users', USER_REGISTRATION_LOOKUP_REASON)
        .select('*')
        .where('user_id', user_id)
        .first();
      return user;
    } catch (error) {
      logger.error(`Error getting user for registration with id ${user_id}:`, error);
      throw error;
    }
  },

  updateLastLogin: async (userId: string, tenant: string, loginMethod: string): Promise<void> => {
    const db = await getAdminConnection();
    try {
      const updated = await tenantDb(db, tenant).table<IUser>('users')
        .where('user_id', userId)
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

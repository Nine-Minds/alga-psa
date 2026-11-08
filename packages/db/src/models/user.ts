import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type {
  IUser,
  IRole,
  IUserRole,
  IUserWithRoles,
  IRoleWithPermissions,
} from '@alga-psa/types';
import { INTERACTIVE_USER_TYPES } from '@alga-psa/types';
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
const INTERNAL_EMAIL_CLAIM_REASON = 'internal user emails are unique across tenants, including pending co-managed administrators';

export type InternalEmailClaim =
  | { kind: 'user'; tenant: string; userId: string }
  | { kind: 'pending_administrator'; tenant: string };

interface RoleWithPermissionRow {
  role_id: string;
  role_name: string;
  description: string | null;
  tenant: string;
  msp: boolean;
  client: boolean;
  permission_id: string | null;
  resource: string | null;
  action: string | null;
  permission_tenant: string | null;
  permission_msp: boolean | null;
  permission_client: boolean | null;
}

export function groupRolePermissionRows(rows: RoleWithPermissionRow[]): IRoleWithPermissions[] {
  const byRole = new Map<string, IRoleWithPermissions>();
  for (const row of rows) {
    let role = byRole.get(row.role_id);
    if (!role) {
      role = {
        role_id: row.role_id,
        role_name: row.role_name,
        description: row.description ?? undefined,
        tenant: row.tenant,
        msp: row.msp,
        client: row.client,
        permissions: [],
      };
      byRole.set(row.role_id, role);
    }
    if (row.permission_id) {
      role.permissions.push({
        permission_id: row.permission_id,
        resource: row.resource as string,
        action: row.action as string,
        tenant: row.permission_tenant ?? undefined,
        msp: Boolean(row.permission_msp),
        client: Boolean(row.permission_client),
      });
    }
  }
  return [...byRole.values()];
}

const User = {
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    includeInactive = false,
    options: { includeNonInteractive?: boolean } = {}
  ): Promise<IUser[]> => {
    const tenant = await requireTenantId(knexOrTrx);
    try {
      let query = tenantDb(knexOrTrx, tenant).table<IUser>('users').select('*');
      // Non-interactive principals (e.g. service) are never part of the default user list.
      if (!options.includeNonInteractive) {
        query = query.whereIn('user_type', [...INTERACTIVE_USER_TYPES]);
      }
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

  findUserByEmailAndType: async (email: string, userType: 'internal' | 'client' | 'service'): Promise<IUser | undefined> => {
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

  /**
   * Every user of this type with this email, across tenants. The `.first()`
   * sibling above answers an arbitrary one of them, which is wrong for sign-in
   * when no tenant is known: callers need to see the ambiguity to refuse it.
   */
  findUsersByEmailAndType: async (email: string, userType: 'internal' | 'client' | 'service'): Promise<IUser[]> => {
    const db = await getAdminConnection();
    try {
      return await tenantDb(db, USER_MODEL_DISCOVERY_TENANT)
        .unscoped<IUser>('users', USER_DISCOVERY_BY_EMAIL_AND_TYPE_REASON)
        .select('*')
        .where({ email: email.toLowerCase(), user_type: userType });
    } catch (error) {
      logger.error(`Error finding users with email ${email} and type ${userType}:`, error);
      throw error;
    }
  },

  /**
   * Internal users sign in with an email and no tenant, so an internal email
   * identifies one account platform-wide. It is claimed by an internal user in
   * any tenant, and by the initial administrator of a co-managed workspace
   * that nobody has signed up for yet: if someone else took the email first,
   * that workspace could never be claimed and would hold its seats.
   * Every internal-user create, invite and email change asks this one question.
   */
  findInternalEmailClaim: async (email: string, options: {
    /** Ignore this user (an email change re-saving its own address). */
    excludeUserId?: string;
    /** Ignore pending administrators of this tenant's own setup. */
    excludeTenant?: string;
    /** Ignore this co-managed setup (a retry of the same request). */
    excludeOperationId?: string;
    db?: Knex;
  } = {}): Promise<InternalEmailClaim | null> => {
    const db = options.db ?? await getAdminConnection();
    const normalized = email.trim().toLowerCase();
    const discovery = tenantDb(db, USER_MODEL_DISCOVERY_TENANT);
    const users = discovery.unscoped<IUser>('users', INTERNAL_EMAIL_CLAIM_REASON)
      .whereRaw('lower(trim(email)) = ?', [normalized]).where('user_type', 'internal');
    if (options.excludeUserId) users.whereNot('user_id', options.excludeUserId);
    const user = await users.first('tenant', 'user_id');
    if (user) return { kind: 'user', tenant: user.tenant, userId: user.user_id };
    // A setup's administrator invitation is created by its worker, so a queued
    // or failed setup without one still claims the email; once the invitation
    // exists, it claims it until used (signing up makes a user, seen above).
    const setups = discovery.unscoped('co_managed_provisioning_operations as o', INTERNAL_EMAIL_CLAIM_REASON)
      .leftJoin('user_invitations as i', function () {
        this.on('i.tenant', 'o.customer_tenant').andOn('i.invitation_id', 'o.administrator_invitation_id');
      })
      .whereRaw("lower(trim(o.request->'administrator'->>'email')) = ?", [normalized])
      .where(function () {
        this.where(function () { this.whereNull('i.invitation_id').whereIn('o.state', ['queued', 'provisioning', 'failed']); })
          .orWhere(function () { this.whereNotNull('i.invitation_id').whereNull('i.used_at'); });
      });
    if (options.excludeTenant) setups.whereNot('o.customer_tenant', options.excludeTenant);
    if (options.excludeOperationId) setups.whereNot('o.operation_id', options.excludeOperationId);
    const setup = await setups.first('o.customer_tenant');
    return setup ? { kind: 'pending_administrator', tenant: setup.customer_tenant } : null;
  },

  findUserByEmailTenantAndType: async (
    email: string,
    tenantId: string,
    userType: 'internal' | 'client' | 'service'
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
      const updated = await tenantDb(db, tenant).table<IUser>('users').where({ user_id }).update({ hashed_password });
      if (updated !== 1) {
        throw new Error(`Expected to update one password row for user ${user_id} in tenant ${tenant}; updated ${updated}`);
      }
      logger.system(`Password updated for user ${user_id} in tenant ${tenant}`);
    } catch (error) {
      logger.error(`Error updating password for user ${user_id} in tenant ${tenant}:`, error);
      throw error;
    }
  },

  updatePasswordIfCurrent: async (
    user_id: string,
    tenant: string,
    observed_hash: string | null,
    hashed_password: string,
  ): Promise<boolean> => {
    const db = await getAdminConnection();
    try {
      let query = tenantDb(db, tenant)
        .table<IUser>('users')
        .where({ user_id });
      query = observed_hash === null
        ? query.whereNull('hashed_password')
        : query.where({ hashed_password: observed_hash });
      const updated = await query.update({ hashed_password });
      return updated > 0;
    } catch (error) {
      logger.error(`Error conditionally updating password for user ${user_id} in tenant ${tenant}:`, error);
      throw error;
    }
  },

  updatePasswordIfUnchanged: async (
    user_id: string,
    tenant: string,
    expectedHash: string | null,
    hashed_password: string
  ): Promise<boolean> => {
    const db = await getAdminConnection();
    const query = tenantDb(db, tenant).table<IUser>('users').where({ user_id });
    if (expectedHash === null) query.whereNull('hashed_password');
    else query.where('hashed_password', expectedHash);
    const updated = await query.update({ hashed_password });
    return updated > 0;
  },

  getPasswordHash: async (user_id: string, tenant: string): Promise<string | null> => {
    const db = await getAdminConnection();
    const user = await tenantDb(db, tenant).table<IUser>('users')
      .select('hashed_password')
      .where({ user_id })
      .first();
    return user?.hashed_password ?? null;
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
      // One round trip on one connection. The previous per-role fan-out held
      // a pool connection per role for every permission check, which is what
      // pushed small appliances past max_connections under a burst of API calls.
      const query = db.table<IRole>('roles')
        .where('user_roles.user_id', user_id);
      db.tenantJoin(query, 'user_roles', 'roles.role_id', 'user_roles.role_id');
      db.tenantJoin(query, 'role_permissions', 'roles.role_id', 'role_permissions.role_id', { type: 'left' });
      db.tenantJoin(query, 'permissions', 'role_permissions.permission_id', 'permissions.permission_id', { type: 'left' });

      const rows: RoleWithPermissionRow[] = await query.select([
        'roles.role_id',
        'roles.role_name',
        'roles.description',
        'roles.tenant',
        'roles.msp',
        'roles.client',
        'permissions.permission_id',
        'permissions.resource',
        'permissions.action',
        'permissions.tenant as permission_tenant',
        'permissions.msp as permission_msp',
        'permissions.client as permission_client',
      ]);

      return groupRolePermissionRows(rows);
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

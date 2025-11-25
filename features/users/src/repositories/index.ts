/**
 * User repository - data access layer for users
 *
 * This repository provides database operations for users, roles, and permissions.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  User,
  Role,
  Permission,
  UserRole,
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
  UserListResponse,
  RoleWithPermissions,
  UserWithRoles,
} from '../types/index.js';

const USERS_TABLE = 'users';
const ROLES_TABLE = 'roles';
const PERMISSIONS_TABLE = 'permissions';
const USER_ROLES_TABLE = 'user_roles';
const ROLE_PERMISSIONS_TABLE = 'role_permissions';

/**
 * Create the user repository with database connection
 */
export function createUserRepository(knex: Knex) {
  return {
    /**
     * Find a user by ID
     */
    async findById(
      tenantId: string,
      userId: string
    ): Promise<User | null> {
      const result = await knex(USERS_TABLE)
        .where({ tenant: tenantId, user_id: userId })
        .first();
      return result || null;
    },

    /**
     * Find a user by email
     */
    async findByEmail(
      tenantId: string,
      email: string
    ): Promise<User | null> {
      const result = await knex(USERS_TABLE)
        .where({ tenant: tenantId, email: email.toLowerCase() })
        .first();
      return result || null;
    },

    /**
     * Find a user by username
     */
    async findByUsername(
      tenantId: string,
      username: string
    ): Promise<User | null> {
      const result = await knex(USERS_TABLE)
        .where({ tenant: tenantId, username })
        .first();
      return result || null;
    },

    /**
     * Find users matching filters
     */
    async findMany(
      tenantId: string,
      filters: UserFilters = {}
    ): Promise<UserListResponse> {
      const {
        search,
        user_type,
        is_inactive,
        role_id,
        contact_id,
        limit = 50,
        offset = 0,
        orderBy = 'username',
        orderDirection = 'asc',
      } = filters;

      let query = knex(USERS_TABLE).where({ tenant: tenantId });

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('username', `%${search}%`)
            .orWhereILike('email', `%${search}%`)
            .orWhereILike('first_name', `%${search}%`)
            .orWhereILike('last_name', `%${search}%`);
        });
      }

      // Apply user_type filter
      if (user_type) {
        query = query.where({ user_type });
      }

      // Apply inactive filter
      if (is_inactive !== undefined) {
        query = query.where({ is_inactive });
      }

      // Apply contact filter
      if (contact_id) {
        query = query.where({ contact_id });
      }

      // Apply role filter
      if (role_id) {
        query = query
          .join(USER_ROLES_TABLE, `${USERS_TABLE}.user_id`, `${USER_ROLES_TABLE}.user_id`)
          .where(`${USER_ROLES_TABLE}.role_id`, role_id);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const users = await query
        .select(`${USERS_TABLE}.*`)
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { users, total, limit, offset };
    },

    /**
     * Create a new user
     */
    async create(
      tenantId: string,
      input: CreateUserInput,
      hashedPassword?: string
    ): Promise<User> {
      const userData: any = {
        ...input,
        tenant: tenantId,
        email: input.email.toLowerCase(),
        is_inactive: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Add hashed password if provided
      if (hashedPassword) {
        userData.hashed_password = hashedPassword;
      }

      const [user] = await knex(USERS_TABLE)
        .insert(userData)
        .returning('*');

      return user;
    },

    /**
     * Update an existing user
     */
    async update(
      tenantId: string,
      input: UpdateUserInput
    ): Promise<User | null> {
      const { user_id, ...updateData } = input;

      const [user] = await knex(USERS_TABLE)
        .where({ tenant: tenantId, user_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      return user || null;
    },

    /**
     * Delete a user (soft delete by setting is_inactive)
     */
    async delete(tenantId: string, userId: string): Promise<boolean> {
      const result = await knex(USERS_TABLE)
        .where({ tenant: tenantId, user_id: userId })
        .update({ is_inactive: true, updated_at: new Date() });

      return result > 0;
    },

    /**
     * Hard delete a user (permanent)
     */
    async hardDelete(tenantId: string, userId: string): Promise<boolean> {
      // Delete user roles first
      await knex(USER_ROLES_TABLE)
        .where({ user_id: userId, tenant: tenantId })
        .delete();

      const result = await knex(USERS_TABLE)
        .where({ tenant: tenantId, user_id: userId })
        .delete();

      return result > 0;
    },

    /**
     * Assign a role to a user
     */
    async assignRole(
      tenantId: string,
      userId: string,
      roleId: string
    ): Promise<UserRole> {
      // Check if assignment already exists
      const existing = await knex(USER_ROLES_TABLE)
        .where({ user_id: userId, role_id: roleId, tenant: tenantId })
        .first();

      if (existing) {
        return existing;
      }

      const [userRole] = await knex(USER_ROLES_TABLE)
        .insert({
          user_id: userId,
          role_id: roleId,
          tenant: tenantId,
        })
        .returning('*');

      return userRole;
    },

    /**
     * Remove a role from a user
     */
    async removeRole(
      tenantId: string,
      userId: string,
      roleId: string
    ): Promise<boolean> {
      const result = await knex(USER_ROLES_TABLE)
        .where({ user_id: userId, role_id: roleId, tenant: tenantId })
        .delete();

      return result > 0;
    },

    /**
     * Get roles for a user
     */
    async getUserRoles(
      tenantId: string,
      userId: string
    ): Promise<Role[]> {
      const roles = await knex(ROLES_TABLE)
        .join(USER_ROLES_TABLE, `${ROLES_TABLE}.role_id`, `${USER_ROLES_TABLE}.role_id`)
        .where({
          [`${USER_ROLES_TABLE}.user_id`]: userId,
          [`${USER_ROLES_TABLE}.tenant`]: tenantId,
        })
        .select(`${ROLES_TABLE}.*`);

      return roles;
    },

    /**
     * Get permissions for a user (through their roles)
     */
    async getUserPermissions(
      tenantId: string,
      userId: string
    ): Promise<Permission[]> {
      const permissions = await knex(PERMISSIONS_TABLE)
        .join(ROLE_PERMISSIONS_TABLE, `${PERMISSIONS_TABLE}.permission_id`, `${ROLE_PERMISSIONS_TABLE}.permission_id`)
        .join(USER_ROLES_TABLE, `${ROLE_PERMISSIONS_TABLE}.role_id`, `${USER_ROLES_TABLE}.role_id`)
        .where({
          [`${USER_ROLES_TABLE}.user_id`]: userId,
          [`${USER_ROLES_TABLE}.tenant`]: tenantId,
        })
        .distinct(`${PERMISSIONS_TABLE}.*`);

      return permissions;
    },

    /**
     * Get a user with their roles
     */
    async findByIdWithRoles(
      tenantId: string,
      userId: string
    ): Promise<UserWithRoles | null> {
      const user = await this.findById(tenantId, userId);
      if (!user) {
        return null;
      }

      const roles = await this.getUserRoles(tenantId, userId);

      return {
        ...user,
        roles,
      };
    },

    /**
     * Get all roles
     */
    async getAllRoles(tenantId?: string): Promise<Role[]> {
      let query = knex(ROLES_TABLE);

      if (tenantId) {
        query = query.where({ tenant: tenantId }).orWhereNull('tenant');
      }

      return query.select('*');
    },

    /**
     * Get a role by ID
     */
    async getRoleById(roleId: string): Promise<Role | null> {
      const result = await knex(ROLES_TABLE)
        .where({ role_id: roleId })
        .first();
      return result || null;
    },

    /**
     * Get a role with its permissions
     */
    async getRoleWithPermissions(roleId: string): Promise<RoleWithPermissions | null> {
      const role = await this.getRoleById(roleId);
      if (!role) {
        return null;
      }

      const permissions = await knex(PERMISSIONS_TABLE)
        .join(ROLE_PERMISSIONS_TABLE, `${PERMISSIONS_TABLE}.permission_id`, `${ROLE_PERMISSIONS_TABLE}.permission_id`)
        .where({ [`${ROLE_PERMISSIONS_TABLE}.role_id`]: roleId })
        .select(`${PERMISSIONS_TABLE}.*`);

      return {
        ...role,
        permissions,
      };
    },
  };
}

// Default export for convenience when used with dependency injection
export const userRepository = {
  create: createUserRepository,
};

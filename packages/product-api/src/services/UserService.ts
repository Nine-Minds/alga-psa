/**
 * User Service
 * Comprehensive service layer for user-related operations
 * Provides business logic integration with existing user server actions and database operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { withTransaction } from '@shared/db';
import { IUser, IUserWithRoles, IRole, IRoleWithPermissions, ITeam } from 'server/src/interfaces/auth.interfaces';
import { ListOptions } from '@product/api/controllers/types';
import { 
  CreateUserData, 
  UpdateUserData, 
  UserFilterData,
  UserSearchData,
  UserImportData,
  UserExportQuery,
  ChangePasswordData,
  RegisterUserData,
  RegisterClientUserData,
  UserPreferenceData,
  UserActivityLog,
  UserStatsResponse,
  UserPermissionsResponse
} from '@product/api/schemas/userSchemas';
import { hashPassword, verifyPassword } from '@server/utils/encryption/encryption';
import { getUserAvatarUrl } from '@server/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from '@server/lib/services/EntityImageService';
import { hasPermission } from '@server/lib/auth/rbac';
import User from '@server/lib/models/user';
import Team from '@server/lib/models/team';
import UserPreferences from '@server/lib/models/userPreferences';
import { generateResourceLinks, addHateoasLinks } from '@product/api/utils/responseHelpers';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '@product/api/middleware/apiMiddleware';
import logger from '@shared/core/logger';
import { validateSystemContext } from './SystemContext';

// Extended interfaces for service operations
export interface UserWithFullDetails extends IUserWithRoles {
  teams?: ITeam[];
  preferences?: Record<string, any>;
  permissions?: string[];
  stats?: {
    lastLogin?: Date;
    loginCount?: number;
    activeSessions?: number;
    lastActivity?: Date;
  };
  avatarUrl?: string | null;
  logoUrl?: string | null;
  _links?: Record<string, { href: string; method: string; rel: string }>;
}

export interface UserBulkOperationResult {
  total_processed: number;
  successful: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    data: any;
  }>;
  results: any[];
}

export interface UserActivityFilter {
  user_id?: string;
  activity_type?: string[];
  from_date?: Date;
  to_date?: Date;
  ip_address?: string;
}

export class UserService extends BaseService<IUser> {
  constructor() {
    super({
      tableName: 'users',
      primaryKey: 'user_id',
      tenantColumn: 'tenant',
      searchableFields: ['username', 'first_name', 'last_name', 'email', 'phone'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
      softDelete: false, // Users table doesn't have deleted_at column
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });
  }

  /**
   * ====================================
   * CORE CRUD OPERATIONS
   * ====================================
   */

  /**
   * List users with enhanced filtering, roles, and teams
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<UserWithFullDetails>> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();
    const {
      page = 1,
      limit = 25,
      filters = {} as UserFilterData,
      sort,
      order
    } = options;

    // Build base query with user type filtering
    let dataQuery = this.buildEnhancedUserQuery(knex, context);
    let countQuery = this.buildBaseQuery(knex, context);

    // Apply filters
    dataQuery = this.applyUserFilters(dataQuery, filters);
    countQuery = this.applyUserFilters(countQuery, filters);

    // Apply sorting and pagination
    dataQuery = this.applySorting(dataQuery, sort, order);
    dataQuery = this.applyPagination(dataQuery, page, limit);

    // Execute queries
    const [users, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    // Enhance users with additional data
    const enhancedUsers = await this.enhanceUsersWithDetails(users, context, {
      includeRoles: true,
      includeTeams: filters.include_teams,
      includeAvatar: true,
      includePermissions: filters.include_permissions,
      includeHateoas: true
    });

    return {
      data: enhancedUsers,
      total: parseInt(count as string)
    };
  }

  /**
   * Get user by ID with comprehensive details
   */
  async getById(
    id: string, 
    context: ServiceContext,
    options: {
      includeRoles?: boolean;
      includeTeams?: boolean;
      includePermissions?: boolean;
      includePreferences?: boolean;
      includeStats?: boolean;
      includeHateoas?: boolean;
    } = {}
  ): Promise<UserWithFullDetails | null> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();

    const user = await knex('users')
      .where({ user_id: id, tenant: context.tenant })
      .first();

    if (!user) {
      return null;
    }

    // Enhance user with requested details
    const [enhancedUser] = await this.enhanceUsersWithDetails([user], context, {
      includeRoles: options.includeRoles !== false,
      includeTeams: options.includeTeams || false,
      includePermissions: options.includePermissions || false,
      includePreferences: options.includePreferences || false,
      includeStats: options.includeStats || false,
      includeAvatar: true,
      includeHateoas: options.includeHateoas !== false
    });

    return enhancedUser;
  }

  /**
   * Create new user with validation and role assignment
   * Overloads align with BaseService signature while supporting rich DTO
   */
  async create(data: Partial<IUser>, context: ServiceContext): Promise<IUser>;
  async create(data: CreateUserData, context: ServiceContext): Promise<UserWithFullDetails>;
  async create(data: any, context: ServiceContext): Promise<IUser> {
    await this.ensurePermission(context, 'user', 'create');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate email uniqueness per tenant + user_type (allow same email across different types)
      const targetUserType = data.user_type || 'internal';
      const existingUserByEmail = await trx('users')
        .where('tenant', context.tenant)
        .andWhere('email', data.email.toLowerCase())
        .andWhere('user_type', targetUserType)
        .first();

      if (existingUserByEmail) {
        throw new Error('A user with this email address already exists');
      }

      // Validate username uniqueness within tenant + user_type (allow same username across different types)
      const existingUserByUsername = await trx('users')
        .where('tenant', context.tenant)
        .andWhere('username', data.username.toLowerCase())
        .andWhere('user_type', targetUserType)
        .first();

      if (existingUserByUsername) {
        throw new Error('A user with this username already exists for this user type');
      }

      // Validate role IDs if provided
      if (data.role_ids && data.role_ids.length > 0) {
        const roles = await trx('roles')
          .whereIn('role_id', data.role_ids)
          .where('tenant', context.tenant);

        if (roles.length !== data.role_ids.length) {
          throw new Error('One or more invalid role IDs provided');
        }
      }

      // Prepare user data
      const userData = {
        user_id: knex.raw('gen_random_uuid()'),
        username: data.username.toLowerCase(),
        first_name: data.first_name || null,
        last_name: data.last_name || null,
        email: data.email.toLowerCase(),
        hashed_password: await hashPassword(data.password),
        phone: data.phone || null,
        timezone: data.timezone || null,
        user_type: data.user_type || 'internal',
        contact_id: data.contact_id || null,
        two_factor_enabled: data.two_factor_enabled || false,
        is_google_user: data.is_google_user || false,
        is_inactive: data.is_inactive || false,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      // Insert user
      const [createdUser] = await trx('users').insert(userData).returning('*');

      // Assign roles
      if (data.role_ids && data.role_ids.length > 0) {
        const userRoles = data.role_ids.map((roleId: string) => ({
          user_id: createdUser.user_id,
          role_id: roleId,
          tenant: context.tenant
        }));
        await trx('user_roles').insert(userRoles);
      }

      // Create default user preferences
      await this.createDefaultUserPreferences(createdUser.user_id, context, trx);

      // Log user creation activity
      await this.logUserActivity({
        user_id: createdUser.user_id,
        activity_type: 'user_created',
        metadata: { created_by: context.userId }
      }, context, trx);

      // Return enhanced user
      const [enhancedUser] = await this.enhanceUsersWithDetails([createdUser], context, {
        includeRoles: true,
        includeTeams: false,
        includeAvatar: true,
        includeHateoas: true
      }, trx);

      return enhancedUser as unknown as IUser;
    });
  }

  /**
   * Update user with comprehensive validation
   */
  async update(id: string, data: UpdateUserData, context: ServiceContext): Promise<UserWithFullDetails> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify user exists and belongs to tenant
      const existingUser = await trx('users')
        .where({ user_id: id, tenant: context.tenant })
        .first();

      if (!existingUser) {
        throw new Error('User not found or permission denied');
      }

      // Validate email uniqueness per user_type if changing email
      if (data.email && data.email.toLowerCase() !== existingUser.email) {
        const userTypeToCheck = (data.user_type || existingUser.user_type || 'internal');
        const emailExists = await trx('users')
          .where('email', data.email.toLowerCase())
          .andWhere('user_type', userTypeToCheck)
          .whereNot('user_id', id)
          .first();

        if (emailExists) {
          throw new Error('A user with this email address already exists');
        }
      }

      // Prepare update data
      const updateData = {
        ...data,
        email: data.email ? data.email.toLowerCase() : undefined,
        username: data.username ? data.username.toLowerCase() : undefined,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if ((updateData as any)[key] === undefined) {
          delete (updateData as any)[key];
        }
      });

      // Update user
      const [updatedUser] = await trx('users')
        .where({ user_id: id, tenant: context.tenant })
        .update(updateData)
        .returning('*');

      // Log user update activity
      await this.logUserActivity({
        user_id: id,
        activity_type: 'profile_update',
        metadata: { 
          updated_by: context.userId,
          fields_updated: Object.keys(updateData)
        }
      }, context, trx);

      // Return enhanced user
      const [enhancedUser] = await this.enhanceUsersWithDetails([updatedUser], context, {
        includeRoles: true,
        includeTeams: false,
        includeAvatar: true,
        includeHateoas: true
      }, trx);

      return enhancedUser;
    });
  }

  /**
   * Delete user with proper cleanup of related data
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    await this.ensurePermission(context, 'user', 'delete');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify user exists and belongs to tenant
      const existingUser = await trx('users')
        .where({ user_id: id, tenant: context.tenant })
        .first();

      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      // Delete related data in correct order to avoid foreign key constraints
      // 1. Delete user preferences
      await trx('user_preferences')
        .where({ user_id: id, tenant: context.tenant })
        .delete();

      // 2. Delete user roles
      await trx('user_roles')
        .where({ user_id: id, tenant: context.tenant })
        .delete();

      // 3. Delete API keys
      await trx('api_keys')
        .where({ user_id: id, tenant: context.tenant })
        .delete();

      // 4. Set audit columns to NULL for tables with foreign keys to users
      // This is needed because Citus doesn't support ON DELETE SET NULL with distribution key
      const auditTablesToUpdate = [
        'service_categories',
        // Add other tables here as they get audit columns with FKs to users
      ];

      for (const tableName of auditTablesToUpdate) {
        // Check if table exists and has the columns
        const hasTable = await trx.schema.hasTable(tableName);
        if (hasTable) {
          const [hasCreatedBy, hasUpdatedBy] = await Promise.all([
            trx.schema.hasColumn(tableName, 'created_by'),
            trx.schema.hasColumn(tableName, 'updated_by')
          ]);

          if (hasCreatedBy || hasUpdatedBy) {
            const updates: Record<string, null> = {};
            if (hasCreatedBy) updates.created_by = null;
            if (hasUpdatedBy) updates.updated_by = null;

            await trx(tableName)
              .where({ tenant: context.tenant })
              .where(function() {
                if (hasCreatedBy) this.orWhere('created_by', id);
                if (hasUpdatedBy) this.orWhere('updated_by', id);
              })
              .update(updates);
          }
        }
      }

      // 5. Finally delete the user
      await trx('users')
        .where({ user_id: id, tenant: context.tenant })
        .delete();
    });
  }

  /**
   * ====================================
   * USER AUTHENTICATION & SECURITY
   * ====================================
   */

  /**
   * Change user password with validation
   */
  async changePassword(
    data: ChangePasswordData, 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const targetUserId = data.user_id || context.userId;

      // Permission check
      if (targetUserId !== context.userId) {
        await this.ensurePermission(context, 'user', 'update');
      }

      // Get user
      const user = await trx('users')
        .where({ user_id: targetUserId, tenant: context.tenant })
        .first();

      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Verify current password
      if (targetUserId === context.userId) {
        // User changing their own password - current password is required
        if (!data.current_password) {
          throw new ValidationError('Current password is required');
        }
        const isValidPassword = await verifyPassword(data.current_password, user.hashed_password);
        if (!isValidPassword) {
          throw new ValidationError('Current password is incorrect');
        }
      } else {
        // Admin changing another user's password - must have admin permission
        const hasAdminAccess = await hasPermission(context.user!, 'user', 'admin');
        if (!hasAdminAccess) {
          throw new ForbiddenError('Only administrators can change other users\' passwords');
        }
      }

      // Hash new password
      const hashedPassword = await hashPassword(data.new_password);

      // Update password
      await trx('users')
        .where({ user_id: targetUserId, tenant: context.tenant })
        .update({ 
          hashed_password: hashedPassword,
          updated_at: knex.raw('now()')
        });

      // Log password change activity
      await this.logUserActivity({
        user_id: targetUserId,
        activity_type: 'password_change',
        metadata: { changed_by: context.userId }
      }, context, trx);

      return { success: true, message: 'Password updated successfully' };
    });
  }

  /**
   * Enable 2FA for user
   */
  async enable2FA(
    userId: string,
    secret: string,
    token: string,
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Permission check
      if (userId !== context.userId) {
        await this.ensurePermission(context, 'user', 'update');
      }

      // TODO: Implement 2FA token verification logic here
      // This would typically involve verifying the TOTP token against the secret

      // Update user 2FA settings
      await trx('users')
        .where({ user_id: userId, tenant: context.tenant })
        .update({
          two_factor_enabled: true,
          two_factor_secret: secret,
          updated_at: knex.raw('now()')
        });

      // Log 2FA enable activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: '2fa_enabled',
        metadata: { enabled_by: context.userId }
      }, context, trx);

      return { success: true, message: '2FA enabled successfully' };
    });
  }

  /**
   * Disable 2FA for user
   */
  async disable2FA(userId: string, context: ServiceContext): Promise<{ success: boolean; message: string }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Permission check
      if (userId !== context.userId) {
        await this.ensurePermission(context, 'user', 'update');
      }

      // Update user 2FA settings
      await trx('users')
        .where({ user_id: userId, tenant: context.tenant })
        .update({
          two_factor_enabled: false,
          two_factor_secret: null,
          updated_at: knex.raw('now()')
        });

      // Log 2FA disable activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: '2fa_disabled',
        metadata: { disabled_by: context.userId }
      }, context, trx);

      return { success: true, message: '2FA disabled successfully' };
    });
  }

  /**
   * ====================================
   * ROLE MANAGEMENT
   * ====================================
   */

  /**
   * Get user roles with permissions
   */
  async getUserRoles(userId: string, context: ServiceContext): Promise<IRoleWithPermissions[]> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();
    return User.getUserRolesWithPermissions(knex, userId);
  }

  /**
   * Assign roles to user
   */
  async assignRoles(
    userId: string, 
    roleIds: string[], 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify user exists
      const user = await trx('users')
        .where({ user_id: userId, tenant: context.tenant })
        .first();

      if (!user) {
        throw new Error('User not found');
      }

      // Verify all roles exist
      const roles = await trx('roles')
        .whereIn('role_id', roleIds)
        .where('tenant', context.tenant);

      if (roles.length !== roleIds.length) {
        throw new Error('One or more invalid role IDs provided');
      }

      // Remove existing roles
      await trx('user_roles')
        .where({ user_id: userId, tenant: context.tenant })
        .del();

      // Add new roles
      if (roleIds.length > 0) {
        const userRoles = roleIds.map(roleId => ({
          user_id: userId,
          role_id: roleId,
          tenant: context.tenant
        }));
        await trx('user_roles').insert(userRoles);
      }

      // Log role change activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: 'role_change',
        metadata: { 
          assigned_by: context.userId,
          role_ids: roleIds,
          role_names: roles.map(r => r.role_name)
        }
      }, context, trx);

      return { success: true, message: 'Roles assigned successfully' };
    });
  }

  /**
   * Remove roles from user
   */
  async removeRoles(
    userId: string, 
    roleIds: string[], 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Remove specified roles
      await trx('user_roles')
        .where({ user_id: userId, tenant: context.tenant })
        .whereIn('role_id', roleIds)
        .del();

      // Log role removal activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: 'role_change',
        metadata: { 
          removed_by: context.userId,
          removed_role_ids: roleIds
        }
      }, context, trx);

      return { success: true, message: 'Roles removed successfully' };
    });
  }

  /**
   * ====================================
   * TEAM MEMBERSHIPS
   * ====================================
   */

  /**
   * Get user team memberships
   */
  async getUserTeams(userId: string, context: ServiceContext): Promise<ITeam[]> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();

    const teams = await knex('teams as t')
      .join('team_members as tm', function() {
        this.on('t.team_id', '=', 'tm.team_id')
            .andOn('t.tenant', '=', 'tm.tenant');
      })
      .where({
        'tm.user_id': userId,
        't.tenant': context.tenant
      })
      .select('t.*', knex.raw('tm.user_id = t.manager_id as is_manager'))
      .orderBy('t.team_name');

    return teams;
  }

  /**
   * Add user to team
   */
  async addToTeam(
    userId: string, 
    teamId: string, 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Use existing Team model method
      await Team.addMember(trx, teamId, userId);

      // Log team join activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: 'team_join',
        metadata: { 
          team_id: teamId,
          added_by: context.userId
        }
      }, context, trx);

      return { success: true, message: 'User added to team successfully' };
    });
  }

  /**
   * Remove user from team
   */
  async removeFromTeam(
    userId: string, 
    teamId: string, 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Use existing Team model method
      await Team.removeMember(trx, teamId, userId);

      // Log team leave activity
      await this.logUserActivity({
        user_id: userId,
        activity_type: 'team_leave',
        metadata: { 
          team_id: teamId,
          removed_by: context.userId
        }
      }, context, trx);

      return { success: true, message: 'User removed from team successfully' };
    });
  }

  /**
   * ====================================
   * USER PREFERENCES
   * ====================================
   */

  /**
   * Get user preferences
   */
  async getUserPreferences(userId: string, context: ServiceContext): Promise<Record<string, any>> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();

    const preferences = await knex('user_preferences')
      .where({ user_id: userId, tenant: context.tenant })
      .select('setting_name', 'setting_value');

    const result: Record<string, any> = {};
    preferences.forEach(pref => {
      try {
        result[pref.setting_name] = JSON.parse(pref.setting_value);
      } catch {
        result[pref.setting_name] = pref.setting_value;
      }
    });

    return result;
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    userId: string, 
    preferences: Record<string, any>, 
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    // Users can update their own preferences, or admins can update any
    if (userId !== context.userId) {
      await this.ensurePermission(context, 'user', 'update');
    }
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      for (const [settingName, settingValue] of Object.entries(preferences)) {
        await UserPreferences.upsert(trx, {
          user_id: userId,
          setting_name: settingName,
          setting_value: JSON.stringify(settingValue),
          updated_at: new Date()
        });
      }

      return { success: true, message: 'Preferences updated successfully' };
    });
  }

  /**
   * ====================================
   * SEARCH & FILTERING
   * ====================================
   */

  /**
   * Search users with advanced filtering
   */
  async searchUsers(
    searchData: UserSearchData, 
    context: ServiceContext
  ): Promise<UserWithFullDetails[]> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();

    let query = this.buildEnhancedUserQuery(knex, context);

    // Apply search across specified fields
    if (searchData.query) {
      const searchFields = searchData.fields || this.searchableFields;
      query = query.where(subQuery => {
        searchFields.forEach((field, index) => {
          const tableField = field.includes('.') ? field : `users.${field}`;
          if (index === 0) {
            subQuery.whereILike(tableField, `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike(tableField, `%${searchData.query}%`);
          }
        });
      });
    }

    // Apply additional filters
    if (searchData.user_type) {
      query = query.where('user_type', searchData.user_type);
    }

    if (searchData.role_id) {
      query = query.join('user_roles as ur_search', function() {
        this.on('users.user_id', '=', 'ur_search.user_id')
            .andOn('users.tenant', '=', 'ur_search.tenant');
      }).where('ur_search.role_id', searchData.role_id);
    }

    if (searchData.team_id) {
      query = query.join('team_members as tm_search', function() {
        this.on('users.user_id', '=', 'tm_search.user_id')
            .andOn('users.tenant', '=', 'tm_search.tenant');
      }).where('tm_search.team_id', searchData.team_id);
    }

    if (!searchData.include_inactive) {
      query = query.where('is_inactive', false);
    }

    // Apply limit
    query = query.limit(searchData.limit || 25);

    const users = await query;

    // Enhance users with details
    return this.enhanceUsersWithDetails(users, context, {
      includeRoles: true,
      includeAvatar: true,
      includeHateoas: true
    });
  }

  /**
   * ====================================
   * BULK OPERATIONS
   * ====================================
   */

  /**
   * Bulk create users
   */
  async bulkCreateUsers(
    users: CreateUserData[],
    context: ServiceContext,
    options: {
      send_welcome_email?: boolean;
      force_password_reset?: boolean;
      skip_invalid?: boolean;
      dry_run?: boolean;
    } = {}
  ): Promise<UserBulkOperationResult> {
    await this.ensurePermission(context, 'user', 'create');
    
    if (options.dry_run) {
      // Validate all users without creating them
      const errors: any[] = [];
      users.forEach((userData, index) => {
        try {
          this.validateUserData(userData);
        } catch (error: any) {
          errors.push({
            index,
            error: error.message,
            data: userData
          });
        }
      });

      return {
        total_processed: users.length,
        successful: users.length - errors.length,
        failed: errors.length,
        errors,
        results: []
      };
    }

    const { knex } = await this.getKnex();
    const results: any[] = [];
    const errors: any[] = [];

    return withTransaction(knex, async (trx) => {
      for (let i = 0; i < users.length; i++) {
        const userData = users[i];
        try {
          const createdUser = await this.create(userData, context);
          results.push(createdUser);
        } catch (error: any) {
          errors.push({
            index: i,
            error: error.message,
            data: userData
          });

          if (!options.skip_invalid) {
            throw error;
          }
        }
      }

      return {
        total_processed: users.length,
        successful: results.length,
        failed: errors.length,
        errors,
        results
      };
    });
  }

  /**
   * Bulk deactivate/activate users
   */
  async bulkDeactivateUsers(
    userIds: string[],
    deactivate: boolean,
    context: ServiceContext
  ): Promise<UserBulkOperationResult> {
    await this.ensurePermission(context, 'user', 'update');
    
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const result = await trx('users')
        .whereIn('user_id', userIds)
        .where('tenant', context.tenant)
        .update({ 
          is_inactive: deactivate,
          updated_at: knex.raw('now()')
        });

      // Log bulk activity
      for (const userId of userIds) {
        await this.logUserActivity({
          user_id: userId,
          activity_type: deactivate ? 'user_deactivated' : 'user_activated',
          metadata: { 
            changed_by: context.userId,
            bulk_operation: true
          }
        }, context, trx);
      }

      return {
        total_processed: userIds.length,
        successful: result,
        failed: userIds.length - result,
        errors: [],
        results: []
      };
    });
  }

  /**
   * ====================================
   * ANALYTICS & REPORTING
   * ====================================
   */

  /**
   * Get user statistics
   */
  async getUserStats(context: ServiceContext): Promise<UserStatsResponse> {
    await this.ensurePermission(context, 'user', 'read');
    
    const { knex } = await this.getKnex();

    const [
      totalStats,
      typeStats,
      roleStats,
      securityStats,
      activityStats
    ] = await Promise.all([
      // Total and active/inactive counts
      knex('users')
        .where('tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_users'),
          knex.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_users'),
          knex.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_users')
        )
        .first(),

      // Users by type
      knex('users')
        .where('tenant', context.tenant)
        .groupBy('user_type')
        .select('user_type', knex.raw('COUNT(*) as count')),

      // Users by role
      knex('users as u')
        .join('user_roles as ur', function() {
          this.on('u.user_id', '=', 'ur.user_id')
              .andOn('u.tenant', '=', 'ur.tenant');
        })
        .join('roles as r', function() {
          this.on('ur.role_id', '=', 'r.role_id')
              .andOn('ur.tenant', '=', 'r.tenant');
        })
        .where('u.tenant', context.tenant)
        .groupBy('r.role_name')
        .select('r.role_name', knex.raw('COUNT(DISTINCT u.user_id) as count')),

      // Security stats
      knex('users')
        .where('tenant', context.tenant)
        .select(
          knex.raw('COUNT(CASE WHEN two_factor_enabled = true THEN 1 END) as users_with_2fa'),
          knex.raw('COUNT(*) as users_without_avatar') // Stub for now since image column might not exist
        )
        .first(),

      // Activity stats (last 30 days) - stub for now
      Promise.resolve({
        recent_logins: 0,
        total_logins: 0
      })
    ]);

    // Calculate users who never logged in - stub for now
    const neverLoggedIn = parseInt(totalStats.total_users) - (activityStats?.recent_logins || 0);

    return {
      total_users: parseInt(totalStats.total_users as string),
      active_users: parseInt(totalStats.active_users as string),
      inactive_users: parseInt(totalStats.inactive_users as string),
      users_by_type: typeStats.reduce((acc: any, row: any) => {
        acc[row.user_type] = parseInt(row.count);
        return acc;
      }, {}),
      users_by_role: roleStats.reduce((acc: any, row: any) => {
        acc[row.role_name] = parseInt(row.count);
        return acc;
      }, {}),
      users_with_2fa: parseInt(securityStats.users_with_2fa as string),
      users_without_avatar: parseInt(securityStats.users_without_avatar as string),
      recent_logins: typeof activityStats?.recent_logins === 'number' ? activityStats.recent_logins : parseInt(activityStats?.recent_logins as string || '0'),
      never_logged_in: neverLoggedIn
    };
  }

  /**
   * Get user activity logs
   */
  async getUserActivityLogs(
    filters: UserActivityFilter,
    context: ServiceContext,
    page: number = 1,
    limit: number = 25
  ): Promise<ListResult<UserActivityLog>> {
    await this.ensurePermission(context, 'user', 'read');
    
    // TODO: Implement when user_activity_logs table is created
    // For now, return empty results
    return {
      data: [],
      total: 0
    };
  }

  /**
   * Get user permissions (method alias for controller)
   */
  async getUserPermissions(userId: string, context: ServiceContext): Promise<string[]> {
    await this.ensurePermission(context, 'user', 'read');
    
    const user = await this.getById(userId, context, {
      includePermissions: true,
      includeRoles: true
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.permissions || [];
  }

  /**
   * Get user activity (method alias for getUserActivityLogs)
   */
  async getUserActivity(
    filters: UserActivityFilter,
    context: ServiceContext,
    page: number = 1,
    limit: number = 25
  ): Promise<ListResult<UserActivityLog>> {
    return this.getUserActivityLogs(filters, context, page, limit);
  }

  /**
   * ====================================
   * AVATAR MANAGEMENT
   * ====================================
   */

  /**
   * Upload user avatar
   */
  async uploadAvatar(
    userId: string,
    file: File,
    context: ServiceContext
  ): Promise<{ success: boolean; message: string; avatarUrl?: string }> {
    // Users can upload their own avatar, or admins can upload for any user
    if (userId !== context.userId) {
      await this.ensurePermission(context, 'user', 'update');
    }

    const uploadResult = await uploadEntityImage(
      'user',
      userId,
      file,
      context.userId,
      context.tenant,
      'user_avatar',
      true
    );

    if (!uploadResult.success) {
      return { 
        success: false, 
        message: uploadResult.message || 'Failed to upload avatar' 
      };
    }

    return {
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl: uploadResult.imageUrl || undefined
    };
  }

  /**
   * Delete user avatar
   */
  async deleteAvatar(
    userId: string,
    context: ServiceContext
  ): Promise<{ success: boolean; message: string }> {
    // Users can delete their own avatar, or admins can delete for any user
    if (userId !== context.userId) {
      await this.ensurePermission(context, 'user', 'update');
    }

    const deleteResult = await deleteEntityImage(
      'user',
      userId,
      context.userId,
      context.tenant
    );

    return {
      success: deleteResult.success,
      message: deleteResult.message || (deleteResult.success ? 'Avatar deleted successfully' : 'Failed to delete avatar')
    };
  }

  /**
   * ====================================
   * HELPER METHODS
   * ====================================
   */

  /**
   * Enhanced user query with joins for roles and other data
   */
  private buildEnhancedUserQuery(knex: Knex, context: ServiceContext): Knex.QueryBuilder {
    return knex('users')
      .where('tenant', context.tenant)
      .select('users.*');
  }

  /**
   * Apply user-specific filters
   */
  private applyUserFilters(query: Knex.QueryBuilder, filters: UserFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'username':
          query.whereILike('username', `%${value}%`);
          break;
        case 'first_name':
          query.whereILike('first_name', `%${value}%`);
          break;
        case 'last_name':
          query.whereILike('last_name', `%${value}%`);
          break;
        case 'email':
          query.whereILike('email', `%${value}%`);
          break;
        case 'phone':
          query.whereILike('phone', `%${value}%`);
          break;
        case 'user_type':
          query.where('user_type', value);
          break;
        case 'is_inactive':
          query.where('is_inactive', value);
          break;
        case 'two_factor_enabled':
          query.where('two_factor_enabled', value);
          break;
        case 'is_google_user':
          query.where('is_google_user', value);
          break;
        case 'has_avatar':
          if (value) {
            query.whereNotNull('image');
          } else {
            query.whereNull('image');
          }
          break;
        case 'timezone':
          query.where('timezone', value);
          break;
        case 'contact_id':
          query.where('contact_id', value);
          break;
        case 'client_id':
          query.join('contacts', function() {
            this.on('users.contact_id', '=', 'contacts.contact_name_id')
                .andOn('users.tenant', '=', 'contacts.tenant');
          }).where('contacts.client_id', value);
          break;
        case 'role_id':
          query.join('user_roles', function() {
            this.on('users.user_id', '=', 'user_roles.user_id')
                .andOn('users.tenant', '=', 'user_roles.tenant');
          }).where('user_roles.role_id', value);
          break;
        case 'role_name':
          query.join('user_roles', function() {
            this.on('users.user_id', '=', 'user_roles.user_id')
                .andOn('users.tenant', '=', 'user_roles.tenant');
          }).join('roles', function() {
            this.on('user_roles.role_id', '=', 'roles.role_id')
                .andOn('user_roles.tenant', '=', 'roles.tenant');
          }).where('roles.role_name', value);
          break;
        case 'team_id':
          query.join('team_members', function() {
            this.on('users.user_id', '=', 'team_members.user_id')
                .andOn('users.tenant', '=', 'team_members.tenant');
          }).where('team_members.team_id', value);
          break;
        case 'search':
          query.where(subQuery => {
            this.searchableFields.forEach((field, index) => {
              if (index === 0) {
                subQuery.whereILike(field, `%${value}%`);
              } else {
                subQuery.orWhereILike(field, `%${value}%`);
              }
            });
          });
          break;
        case 'created_from':
          query.where('created_at', '>=', value);
          break;
        case 'created_to':
          query.where('created_at', '<=', value);
          break;
        case 'updated_from':
          query.where('updated_at', '>=', value);
          break;
        case 'updated_to':
          query.where('updated_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Enhance users with additional details
   */
  private async enhanceUsersWithDetails(
    users: IUser[],
    context: ServiceContext,
    options: {
      includeRoles?: boolean;
      includeTeams?: boolean;
      includePermissions?: boolean;
      includePreferences?: boolean;
      includeStats?: boolean;
      includeAvatar?: boolean;
      includeHateoas?: boolean;
    } = {},
    trx?: Knex.Transaction
  ): Promise<UserWithFullDetails[]> {
    const { knex } = await this.getKnex();
    const db = trx || knex;

    const enhancedUsers: UserWithFullDetails[] = [];

    for (const user of users) {
      let enhancedUser: UserWithFullDetails = { ...user, roles: [] };

      // Include roles
      if (options.includeRoles) {
        try {
          enhancedUser.roles = await User.getUserRoles(db, user.user_id);
        } catch (error) {
          logger.error(`Error fetching roles for user ${user.user_id}:`, error);
          enhancedUser.roles = [];
        }
      }

      // Include teams
      if (options.includeTeams) {
        try {
          enhancedUser.teams = await this.getUserTeams(user.user_id, context);
        } catch (error) {
          logger.error(`Error fetching teams for user ${user.user_id}:`, error);
          enhancedUser.teams = [];
        }
      }

      // Include permissions
      if (options.includePermissions) {
        try {
          const rolesWithPermissions = await User.getUserRolesWithPermissions(db, user.user_id);
          const permissions = new Set<string>();
          
          rolesWithPermissions.forEach(role => {
            role.permissions?.forEach(permission => {
              permissions.add(`${permission.resource}:${permission.action}`);
            });
          });
          
          enhancedUser.permissions = Array.from(permissions);
        } catch (error) {
          logger.error(`Error fetching permissions for user ${user.user_id}:`, error);
          enhancedUser.permissions = [];
        }
      }

      // Include preferences
      if (options.includePreferences) {
        try {
          enhancedUser.preferences = await this.getUserPreferences(user.user_id, context);
        } catch (error) {
          logger.error(`Error fetching preferences for user ${user.user_id}:`, error);
          enhancedUser.preferences = {};
        }
      }

      // Include avatar
      if (options.includeAvatar) {
        try {
          enhancedUser.avatarUrl = await getUserAvatarUrl(user.user_id, context.tenant);
        } catch (error) {
          logger.error(`Error fetching avatar for user ${user.user_id}:`, error);
          enhancedUser.avatarUrl = null;
        }
      }

      // Include HATEOAS links
      if (options.includeHateoas) {
        const baseUrl = '/api/v1';
        const links = generateResourceLinks('users', user.user_id, baseUrl, ['read', 'update', 'delete']);
        
        // Add specific user action links
        links.roles = { href: `${baseUrl}/users/${user.user_id}/roles`, method: 'GET', rel: 'related' };
        links.teams = { href: `${baseUrl}/users/${user.user_id}/teams`, method: 'GET', rel: 'related' };
        links.preferences = { href: `${baseUrl}/users/${user.user_id}/preferences`, method: 'GET', rel: 'related' };
        links.avatar = { href: `${baseUrl}/users/${user.user_id}/avatar`, method: 'GET', rel: 'related' };
        links.permissions = { href: `${baseUrl}/users/${user.user_id}/permissions`, method: 'GET', rel: 'related' };
        
        enhancedUser._links = links;
      }

      enhancedUsers.push(enhancedUser);
    }

    return enhancedUsers;
  }

  /**
   * Ensure user has required permission
   */
  private async ensurePermission(
    context: ServiceContext,
    resource: string,
    action: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    // Validate system context if using zero UUID
    try {
      validateSystemContext(context);
    } catch (error) {
      logger.error('Invalid system context detected', { 
        error, 
        userId: context.userId,
        resource,
        action 
      });
      throw new ForbiddenError('Invalid system context');
    }

    // If validated as system context, bypass permission checks
    if (context.userId === '00000000-0000-0000-0000-000000000000') {
      return;
    }

    const { knex } = await this.getKnex();
    const db = trx || knex;
    
    const hasPermissionResult = await hasPermission(context.user || { user_id: context.userId }, resource, action, db);
    
    if (!hasPermissionResult) {
      throw new Error(`Permission denied: Cannot ${action} ${resource}`);
    }
  }

  /**
   * Validate user data
   */
  private validateUserData(userData: CreateUserData): void {
    if (!userData.username || userData.username.length < 3) {
      throw new Error('Username must be at least 3 characters long');
    }

    if (!userData.email || !userData.email.includes('@')) {
      throw new Error('Valid email is required');
    }

    if (!userData.password || userData.password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Add more validation rules as needed
  }

  /**
   * Create default user preferences
   */
  private async createDefaultUserPreferences(
    userId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const defaultPreferences = {
      theme: 'light',
      language: 'en',
      timezone: 'UTC',
      notifications_email: true,
      notifications_browser: true,
      dashboard_layout: 'default'
    };

    for (const [settingName, settingValue] of Object.entries(defaultPreferences)) {
      await trx('user_preferences').insert({
        user_id: userId,
        setting_name: settingName,
        setting_value: JSON.stringify(settingValue),
        tenant: context.tenant,
        updated_at: new Date()
      });
    }
  }

  /**
   * Log user activity
   */
  private async logUserActivity(
    activity: UserActivityLog,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<void> {
    // TODO: Implement user activity logging when table is created
    // For now, just log to console
    logger.info('User activity:', activity);
  }
}

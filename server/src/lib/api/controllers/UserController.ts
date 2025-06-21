/**
 * User Controller
 * Comprehensive REST API controller for user management operations
 * Integrates with UserService and follows established patterns
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { UserService } from '../services/UserService';
import { 
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
  userSearchSchema,
  userExportQuerySchema,
  changePasswordSchema,
  enable2FASchema,
  verify2FASchema,
  assignUserRolesSchema,
  removeUserRolesSchema,
  addUserToTeamSchema,
  removeUserFromTeamSchema,
  bulkCreateUsersSchema,
  bulkUpdateUsersSchema,
  bulkDeleteUsersSchema,
  bulkDeactivateUsersSchema,
  userActivityFilterSchema,
  uploadAvatarSchema,
  deleteAvatarSchema,
  bulkUpdateUserPreferencesSchema,
  CreateUserData,
  UpdateUserData,
  UserSearchData,
  UserExportQuery,
  ChangePasswordData,
  UserActivityFilter,
  UserBulkActionResult
} from '../schemas/userSchemas';
import { 
  withAuth, 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ValidationError,
  ConflictError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';
import { generateResourceLinks } from '../utils/responseHelpers';

export class UserController extends BaseController {
  private userService: UserService;

  constructor() {
    const userService = new UserService();
    
    super(userService, {
      resource: 'user',
      createSchema: createUserSchema,
      updateSchema: updateUserSchema,
      querySchema: userListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.userService = userService;
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    // Core CRUD endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users',
      method: 'GET',
      resource: 'user',
      action: 'list',
      description: 'List users with filtering and pagination',
      permissions: { resource: 'user', action: 'read' },
      querySchema: userListQuerySchema,
      tags: ['users', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users',
      method: 'POST',
      resource: 'user',
      action: 'create',
      description: 'Create a new user',
      permissions: { resource: 'user', action: 'create' },
      requestSchema: createUserSchema,
      tags: ['users', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user details by ID',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Update user information',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: updateUserSchema,
      tags: ['users', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}',
      method: 'DELETE',
      resource: 'user',
      action: 'delete',
      description: 'Delete a user',
      permissions: { resource: 'user', action: 'delete' },
      tags: ['users', 'management']
    });

    // Search and filtering endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/search',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Advanced user search with filters',
      permissions: { resource: 'user', action: 'read' },
      querySchema: userSearchSchema,
      tags: ['users', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/export',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Export users to CSV, JSON, or Excel',
      permissions: { resource: 'user', action: 'read' },
      querySchema: userExportQuerySchema,
      tags: ['users', 'export']
    });

    // Authentication and security endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/password',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Change user password',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: changePasswordSchema,
      tags: ['users', 'security']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/2fa/enable',
      method: 'POST',
      resource: 'user',
      action: 'update',
      description: 'Enable two-factor authentication',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: enable2FASchema,
      tags: ['users', 'security', '2fa']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/2fa/disable',
      method: 'DELETE',
      resource: 'user',
      action: 'update',
      description: 'Disable two-factor authentication',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'security', '2fa']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/2fa/verify',
      method: 'POST',
      resource: 'user',
      action: 'update',
      description: 'Verify 2FA token',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: verify2FASchema,
      tags: ['users', 'security', '2fa']
    });

    // Role management endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user roles and permissions',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'roles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Assign roles to user',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: assignUserRolesSchema,
      tags: ['users', 'roles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'DELETE',
      resource: 'user',
      action: 'update',
      description: 'Remove roles from user',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: removeUserRolesSchema,
      tags: ['users', 'roles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/permissions',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user effective permissions',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'permissions']
    });

    // Team membership endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/teams',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user team memberships',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/teams',
      method: 'POST',
      resource: 'user',
      action: 'update',
      description: 'Add user to team',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: addUserToTeamSchema,
      tags: ['users', 'teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/teams/{teamId}',
      method: 'DELETE',
      resource: 'user',
      action: 'update',
      description: 'Remove user from team',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'teams']
    });

    // User preferences endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/preferences',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user preferences',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'preferences']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/preferences',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Update user preferences',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: bulkUpdateUserPreferencesSchema,
      tags: ['users', 'preferences']
    });

    // Avatar management endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/avatar',
      method: 'POST',
      resource: 'user',
      action: 'update',
      description: 'Upload user avatar',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'avatar']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/avatar',
      method: 'DELETE',
      resource: 'user',
      action: 'update',
      description: 'Delete user avatar',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'avatar']
    });

    // Activity and analytics endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/stats',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user statistics and analytics',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/activity',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get user activity logs',
      permissions: { resource: 'user', action: 'read' },
      querySchema: userActivityFilterSchema,
      tags: ['users', 'activity']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/activity',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get specific user activity logs',
      permissions: { resource: 'user', action: 'read' },
      querySchema: userActivityFilterSchema,
      tags: ['users', 'activity']
    });

    // Bulk operation endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/bulk/create',
      method: 'POST',
      resource: 'user',
      action: 'create',
      description: 'Bulk create users',
      permissions: { resource: 'user', action: 'create' },
      requestSchema: bulkCreateUsersSchema,
      tags: ['users', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/bulk/update',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Bulk update users',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: bulkUpdateUsersSchema,
      tags: ['users', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/bulk/delete',
      method: 'DELETE',
      resource: 'user',
      action: 'delete',
      description: 'Bulk delete users',
      permissions: { resource: 'user', action: 'delete' },
      requestSchema: bulkDeleteUsersSchema,
      tags: ['users', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/bulk/deactivate',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Bulk activate/deactivate users',
      permissions: { resource: 'user', action: 'update' },
      requestSchema: bulkDeactivateUsersSchema,
      tags: ['users', 'bulk']
    });
  }

  /**
   * ====================================
   * ENHANCED CRUD OPERATIONS
   * ====================================
   */

  /**
   * Enhanced list method with comprehensive filtering
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(userListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'created_at';
      const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions = { page, limit, filters, sort, order };
      const result = await this.userService.list(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'user'
        }
      );
    });
  }

  /**
   * Enhanced getById with comprehensive user data
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const url = new URL(req.url);
      
      // Parse query parameters for include options
      const includeRoles = url.searchParams.get('include_roles') !== 'false';
      const includeTeams = url.searchParams.get('include_teams') === 'true';
      const includePermissions = url.searchParams.get('include_permissions') === 'true';
      const includePreferences = url.searchParams.get('include_preferences') === 'true';
      const includeStats = url.searchParams.get('include_stats') === 'true';

      const user = await this.userService.getById(id, req.context!, {
        includeRoles,
        includeTeams,
        includePermissions,
        includePreferences,
        includeStats,
        includeHateoas: true
      });
      
      if (!user) {
        throw new NotFoundError('User not found');
      }

      return createSuccessResponse(user);
    });
  }

  /**
   * Enhanced create with comprehensive data handling
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createUserSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateUserData) => {
      try {
        const user = await this.userService.create(validatedData, req.context!);
        return createSuccessResponse(user, 201);
      } catch (error: any) {
        if (error.message.includes('email address already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * Enhanced update with comprehensive validation
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateUserSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateUserData) => {
      const id = this.extractIdFromPath(req);
      
      try {
        const user = await this.userService.update(id, validatedData, req.context!);
        return createSuccessResponse(user);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('email address already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * ====================================
   * AUTHENTICATION & SECURITY ENDPOINTS
   * ====================================
   */

  /**
   * Change user password
   */
  changePassword() {
    const middleware = compose(
      withAuth,
      withValidation(changePasswordSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: ChangePasswordData) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const userId = pathParts[pathParts.length - 2]; // Extract user ID from path

      const result = await this.userService.changePassword(
        { ...validatedData, user_id: userId },
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Enable 2FA for user
   */
  enable2FA() {
    const middleware = compose(
      withAuth,
      withValidation(enable2FASchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.enable2FA(
        userId,
        validatedData.secret,
        validatedData.token,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Disable 2FA for user
   */
  disable2FA() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.disable2FA(userId, req.context!);
      return createSuccessResponse(result);
    });
  }

  /**
   * ====================================
   * ROLE MANAGEMENT ENDPOINTS
   * ====================================
   */

  /**
   * Get user roles with permissions
   */
  getUserRoles() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const roles = await this.userService.getUserRoles(userId, req.context!);
      
      return createSuccessResponse({
        user_id: userId,
        roles,
        _links: {
          self: `/api/v1/users/${userId}/roles`,
          user: `/api/v1/users/${userId}`,
          permissions: `/api/v1/users/${userId}/permissions`
        }
      });
    });
  }

  /**
   * Assign roles to user
   */
  assignRoles() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(assignUserRolesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.assignRoles(
        userId,
        validatedData.role_ids,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Remove roles from user
   */
  removeRoles() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(removeUserRolesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.removeRoles(
        userId,
        validatedData.role_ids,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Get user effective permissions
   */
  getUserPermissions() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const user = await this.userService.getById(userId, req.context!, {
        includePermissions: true,
        includeRoles: true
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      return createSuccessResponse({
        user_id: userId,
        permissions: user.permissions || [],
        roles: user.roles || [],
        effective_permissions: user.permissions || [],
        _links: {
          self: `/api/v1/users/${userId}/permissions`,
          user: `/api/v1/users/${userId}`,
          roles: `/api/v1/users/${userId}/roles`
        }
      });
    });
  }

  /**
   * ====================================
   * TEAM MEMBERSHIP ENDPOINTS
   * ====================================
   */

  /**
   * Get user team memberships
   */
  getUserTeams() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const teams = await this.userService.getUserTeams(userId, req.context!);
      
      return createSuccessResponse({
        user_id: userId,
        teams,
        _links: {
          self: `/api/v1/users/${userId}/teams`,
          user: `/api/v1/users/${userId}`
        }
      });
    });
  }

  /**
   * Add user to team
   */
  addToTeam() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(addUserToTeamSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.addToTeam(
        userId,
        validatedData.team_id,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Remove user from team
   */
  removeFromTeam() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const teamId = pathParts[pathParts.length - 1];
      
      const result = await this.userService.removeFromTeam(
        userId,
        teamId,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * ====================================
   * USER PREFERENCES ENDPOINTS
   * ====================================
   */

  /**
   * Get user preferences
   */
  getUserPreferences() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const preferences = await this.userService.getUserPreferences(userId, req.context!);
      
      return createSuccessResponse({
        user_id: userId,
        preferences,
        _links: {
          self: `/api/v1/users/${userId}/preferences`,
          user: `/api/v1/users/${userId}`
        }
      });
    });
  }

  /**
   * Update user preferences
   */
  updateUserPreferences() {
    const middleware = compose(
      withAuth,
      withValidation(bulkUpdateUserPreferencesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.updateUserPreferences(
        userId,
        validatedData.preferences.reduce((acc: any, pref: any) => {
          acc[pref.setting_name] = pref.setting_value;
          return acc;
        }, {}),
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * ====================================
   * AVATAR MANAGEMENT ENDPOINTS
   * ====================================
   */

  /**
   * Upload user avatar
   */
  uploadAvatar() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const formData = await req.formData();
      const file = formData.get('avatar') as File;
      
      if (!file) {
        throw new ValidationError('Avatar file is required');
      }

      const result = await this.userService.uploadAvatar(userId, file, req.context!);
      
      return createSuccessResponse(result);
    });
  }

  /**
   * Delete user avatar
   */
  deleteAvatar() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      
      const result = await this.userService.deleteAvatar(userId, req.context!);
      return createSuccessResponse(result);
    });
  }

  /**
   * ====================================
   * SEARCH & FILTERING ENDPOINTS
   * ====================================
   */

  /**
   * Advanced user search
   */
  searchUsers() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read'),
      withQueryValidation(userSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: UserSearchData) => {
      const users = await this.userService.searchUsers(validatedQuery, req.context!);
      
      return createSuccessResponse(users, 200, {
        query: validatedQuery.query,
        total_results: users.length,
        search_fields: validatedQuery.fields,
        filters: {
          user_type: validatedQuery.user_type,
          role_id: validatedQuery.role_id,
          team_id: validatedQuery.team_id,
          include_inactive: validatedQuery.include_inactive
        }
      });
    });
  }

  /**
   * Export users
   */
  exportUsers() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read'),
      withQueryValidation(userExportQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: UserExportQuery) => {
      const url = new URL(req.url);
      const filters: any = {};
      
      // Extract filter parameters
      url.searchParams.forEach((value, key) => {
        if (!['format', 'include_inactive', 'fields', 'include_roles', 'include_teams', 'include_preferences'].includes(key)) {
          filters[key] = value;
        }
      });

      // TODO: Implement user export functionality in service
      // This would require adding an exportUsers method to UserService
      
      return createSuccessResponse({
        message: 'Export functionality not yet implemented',
        filters: validatedQuery
      });
    });
  }

  /**
   * ====================================
   * ANALYTICS & REPORTING ENDPOINTS
   * ====================================
   */

  /**
   * Get user statistics
   */
  getUserStats() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.userService.getUserStats(req.context!);
      
      return createSuccessResponse({
        ...stats,
        _links: {
          self: '/api/v1/users/stats',
          activity: '/api/v1/users/activity',
          users: '/api/v1/users'
        }
      });
    });
  }

  /**
   * Get user activity logs
   */
  getUserActivity() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read'),
      withQueryValidation(userActivityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: UserActivityFilter) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.userService.getUserActivityLogs(
        validatedQuery,
        req.context!,
        page,
        limit
      );

      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          filters: validatedQuery,
          resource: 'user_activity'
        }
      );
    });
  }

  /**
   * Get specific user activity logs
   */
  getSpecificUserActivity() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read'),
      withQueryValidation(userActivityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: UserActivityFilter) => {
      const userId = this.extractIdFromPath(req);
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const filters = { ...validatedQuery, user_id: userId };
      const result = await this.userService.getUserActivityLogs(
        filters,
        req.context!,
        page,
        limit
      );

      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          filters: filters,
          resource: 'user_activity'
        }
      );
    });
  }

  /**
   * ====================================
   * BULK OPERATIONS ENDPOINTS
   * ====================================
   */

  /**
   * Bulk create users
   */
  bulkCreateUsers() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'create'),
      withValidation(bulkCreateUsersSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.userService.bulkCreateUsers(
        validatedData.users,
        req.context!,
        validatedData.options || {}
      );

      return createSuccessResponse(result, 200, {
        operation: 'bulk_create',
        total_processed: result.total_processed,
        successful: result.successful,
        failed: result.failed
      });
    });
  }

  /**
   * Bulk deactivate users
   */
  bulkDeactivateUsers() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(bulkDeactivateUsersSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.userService.bulkDeactivateUsers(
        validatedData.user_ids,
        validatedData.deactivate,
        req.context!
      );

      return createSuccessResponse(result, 200, {
        operation: validatedData.deactivate ? 'bulk_deactivate' : 'bulk_activate',
        total_processed: result.total_processed,
        successful: result.successful,
        failed: result.failed
      });
    });
  }
}
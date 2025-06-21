/**
 * Permission & Role Controller
 * Comprehensive REST API controller for RBAC (Role-Based Access Control) operations
 * 
 * Features:
 * - Complete CRUD operations for roles and permissions
 * - Role permission management endpoints
 * - User role assignment operations
 * - Permission validation and checking
 * - Role templates and cloning
 * - Access control analytics and auditing
 * - Bulk operations for efficiency
 * - Role-based feature toggles
 * - HATEOAS response formatting
 * - Full middleware integration with authentication, authorization, and validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { PermissionRoleService } from '../services/PermissionRoleService';
import {
  // Permission schemas
  createPermissionSchema,
  updatePermissionSchema,
  permissionListQuerySchema,
  
  // Role schemas
  createRoleSchema,
  updateRoleSchema,
  roleListQuerySchema,
  cloneRoleSchema,
  
  // Role-permission management schemas
  assignPermissionsToRoleSchema,
  removePermissionsFromRoleSchema,
  replaceRolePermissionsSchema,
  
  // User-role management schemas
  assignRolesToUserSchema,
  removeRolesFromUserSchema,
  replaceUserRolesSchema,
  
  // Permission check schemas
  permissionChecksSchema,
  featureAccessCheckSchema,
  
  // Bulk operation schemas
  bulkCreateRolesSchema,
  bulkUpdateRolesSchema,
  bulkDeleteRolesSchema,
  
  // Type definitions
  CreatePermissionData,
  UpdatePermissionData,
  CreateRoleData,
  UpdateRoleData,
  AssignPermissionsToRoleData,
  AssignRolesToUserData,
  PermissionChecksData,
  FeatureAccessCheck,
  BulkCreateRolesData,
  BulkUpdateRolesData,
  BulkDeleteRolesData
} from '../schemas/permissionRoleSchemas';
import {
  withAuth,
  withPermission,
  withValidation,
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';
import { z } from 'zod';

export class PermissionRoleController extends BaseController {
  private permissionRoleService: PermissionRoleService;

  constructor() {
    const permissionRoleService = new PermissionRoleService();
    
    super(permissionRoleService, {
      resource: 'permission',
      createSchema: createPermissionSchema,
      updateSchema: updatePermissionSchema,
      querySchema: permissionListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.permissionRoleService = permissionRoleService;
    this.registerEndpoints();
  }

  /**
   * Register all endpoints with the API metadata system
   */
  private registerEndpoints(): void {
    // Permission endpoints
    this.registerPermissionEndpoints();
    
    // Role endpoints
    this.registerRoleEndpoints();
    
    // Role-permission management endpoints
    this.registerRolePermissionEndpoints();
    
    // User-role management endpoints
    this.registerUserRoleEndpoints();
    
    // Permission checking endpoints
    this.registerPermissionCheckEndpoints();
    
    // Analytics endpoints
    this.registerAnalyticsEndpoints();
    
    // Bulk operations endpoints
    this.registerBulkOperationEndpoints();
    
    // Feature toggle endpoints
    this.registerFeatureToggleEndpoints();
    
    // Role template endpoints
    this.registerRoleTemplateEndpoints();
  }

  private registerPermissionEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions',
      method: 'GET',
      resource: 'permission',
      action: 'list',
      description: 'List permissions with optional categorization and filtering',
      permissions: { resource: 'permission', action: 'read' },
      querySchema: permissionListQuerySchema,
      tags: ['permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions',
      method: 'POST',
      resource: 'permission',
      action: 'create',
      description: 'Create a new permission',
      permissions: { resource: 'permission', action: 'create' },
      requestSchema: createPermissionSchema,
      tags: ['permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/{id}',
      method: 'GET',
      resource: 'permission',
      action: 'read',
      description: 'Get permission details by ID',
      permissions: { resource: 'permission', action: 'read' },
      tags: ['permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/{id}',
      method: 'PUT',
      resource: 'permission',
      action: 'update',
      description: 'Update permission details',
      permissions: { resource: 'permission', action: 'update' },
      requestSchema: updatePermissionSchema,
      tags: ['permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/{id}',
      method: 'DELETE',
      resource: 'permission',
      action: 'delete',
      description: 'Delete a permission',
      permissions: { resource: 'permission', action: 'delete' },
      tags: ['permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/categories',
      method: 'GET',
      resource: 'permission',
      action: 'read',
      description: 'Get permissions grouped by resource categories',
      permissions: { resource: 'permission', action: 'read' },
      tags: ['permissions', 'rbac', 'categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/usage-analytics',
      method: 'GET',
      resource: 'permission',
      action: 'read',
      description: 'Get permission usage analytics',
      permissions: { resource: 'permission', action: 'read' },
      tags: ['permissions', 'rbac', 'analytics']
    });
  }

  private registerRoleEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles',
      method: 'GET',
      resource: 'role',
      action: 'list',
      description: 'List roles with advanced filtering',
      permissions: { resource: 'role', action: 'read' },
      querySchema: roleListQuerySchema,
      tags: ['roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles',
      method: 'POST',
      resource: 'role',
      action: 'create',
      description: 'Create a new role',
      permissions: { resource: 'role', action: 'create' },
      requestSchema: createRoleSchema,
      tags: ['roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}',
      method: 'GET',
      resource: 'role',
      action: 'read',
      description: 'Get role details by ID with optional permissions',
      permissions: { resource: 'role', action: 'read' },
      tags: ['roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}',
      method: 'PUT',
      resource: 'role',
      action: 'update',
      description: 'Update role information',
      permissions: { resource: 'role', action: 'update' },
      requestSchema: updateRoleSchema,
      tags: ['roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}',
      method: 'DELETE',
      resource: 'role',
      action: 'delete',
      description: 'Delete a role',
      permissions: { resource: 'role', action: 'delete' },
      tags: ['roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/usage-analytics',
      method: 'GET',
      resource: 'role',
      action: 'read',
      description: 'Get role usage analytics',
      permissions: { resource: 'role', action: 'read' },
      tags: ['roles', 'rbac', 'analytics']
    });
  }

  private registerRolePermissionEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}/permissions',
      method: 'GET',
      resource: 'role',
      action: 'read',
      description: 'Get permissions assigned to a role',
      permissions: { resource: 'role', action: 'read' },
      tags: ['roles', 'permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}/permissions',
      method: 'POST',
      resource: 'role',
      action: 'update',
      description: 'Assign permissions to a role',
      permissions: { resource: 'role', action: 'update' },
      tags: ['roles', 'permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}/permissions',
      method: 'PUT',
      resource: 'role',
      action: 'update',
      description: 'Replace all permissions for a role',
      permissions: { resource: 'role', action: 'update' },
      tags: ['roles', 'permissions', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}/permissions',
      method: 'DELETE',
      resource: 'role',
      action: 'update',
      description: 'Remove permissions from a role',
      permissions: { resource: 'role', action: 'update' },
      tags: ['roles', 'permissions', 'rbac']
    });
  }

  private registerUserRoleEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'Get roles assigned to a user',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'POST',
      resource: 'user',
      action: 'update',
      description: 'Assign roles to a user',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'PUT',
      resource: 'user',
      action: 'update',
      description: 'Replace all roles for a user',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/roles',
      method: 'DELETE',
      resource: 'user',
      action: 'update',
      description: 'Remove roles from a user',
      permissions: { resource: 'user', action: 'update' },
      tags: ['users', 'roles', 'rbac']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users-with-roles',
      method: 'GET',
      resource: 'user',
      action: 'read',
      description: 'List users with their assigned roles',
      permissions: { resource: 'user', action: 'read' },
      tags: ['users', 'roles', 'rbac']
    });
  }

  private registerPermissionCheckEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/permissions/check',
      method: 'POST',
      resource: 'permission',
      action: 'check',
      description: 'Check multiple permissions for a user',
      permissions: { resource: 'permission', action: 'read' },
      requestSchema: permissionChecksSchema,
      tags: ['permissions', 'rbac', 'validation']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/users/{id}/permissions/check/{resource}/{action}',
      method: 'GET',
      resource: 'permission',
      action: 'check',
      description: 'Check single permission for a user',
      permissions: { resource: 'permission', action: 'read' },
      tags: ['permissions', 'rbac', 'validation']
    });
  }

  private registerAnalyticsEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/access-control/metrics',
      method: 'GET',
      resource: 'role',
      action: 'read',
      description: 'Get comprehensive access control metrics',
      permissions: { resource: 'role', action: 'read' },
      tags: ['rbac', 'analytics', 'metrics']
    });
  }

  private registerBulkOperationEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/bulk',
      method: 'POST',
      resource: 'role',
      action: 'create',
      description: 'Bulk create roles',
      permissions: { resource: 'role', action: 'create' },
      requestSchema: bulkCreateRolesSchema,
      tags: ['roles', 'rbac', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/bulk',
      method: 'PUT',
      resource: 'role',
      action: 'update',
      description: 'Bulk update roles',
      permissions: { resource: 'role', action: 'update' },
      requestSchema: bulkUpdateRolesSchema,
      tags: ['roles', 'rbac', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/bulk',
      method: 'DELETE',
      resource: 'role',
      action: 'delete',
      description: 'Bulk delete roles',
      permissions: { resource: 'role', action: 'delete' },
      requestSchema: bulkDeleteRolesSchema,
      tags: ['roles', 'rbac', 'bulk']
    });
  }

  private registerFeatureToggleEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/features/access-check',
      method: 'POST',
      resource: 'feature',
      action: 'check',
      description: 'Check feature access for a user',
      permissions: { resource: 'permission', action: 'read' },
      requestSchema: featureAccessCheckSchema,
      tags: ['features', 'rbac', 'toggles']
    });
  }

  private registerRoleTemplateEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/templates',
      method: 'GET',
      resource: 'role',
      action: 'read',
      description: 'Get available role templates',
      permissions: { resource: 'role', action: 'read' },
      tags: ['roles', 'rbac', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/roles/{id}/clone',
      method: 'POST',
      resource: 'role',
      action: 'create',
      description: 'Clone an existing role',
      permissions: { resource: 'role', action: 'create' },
      requestSchema: cloneRoleSchema,
      tags: ['roles', 'rbac', 'templates']
    });
  }

  // =============================================================================
  // PERMISSION ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/permissions - List permissions with optional categorization
   */
  listPermissions() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read'),
      withQueryValidation(permissionListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'resource';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';
      const categorize = url.searchParams.get('categorize') === 'true';

      const listOptions = {
        page,
        limit,
        filters: validatedQuery,
        sort,
        order,
        categorize
      };

      const result = await this.permissionRoleService.listPermissions(listOptions, req.context!);

      if ('categories' in result) {
        return createSuccessResponse(result);
      }

      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters: validatedQuery,
          resource: 'permission'
        }
      );
    });
  }

  /**
   * GET /api/v1/permissions/{id} - Get permission by ID
   */
  getPermissionById() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const permissionId = this.extractIdFromPath(req);
      const permission = await this.permissionRoleService.getPermissionById(permissionId, req.context!);
      
      if (!permission) {
        throw new NotFoundError('Permission not found');
      }

      return createSuccessResponse(permission);
    });
  }

  /**
   * POST /api/v1/permissions - Create new permission
   */
  createPermission() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'create'),
      withValidation(createPermissionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePermissionData) => {
      const permission = await this.permissionRoleService.createPermission(validatedData, req.context!);
      return createSuccessResponse(permission, 201);
    });
  }

  /**
   * PUT /api/v1/permissions/{id} - Update permission
   */
  updatePermission() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'update'),
      withValidation(updatePermissionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdatePermissionData) => {
      const permissionId = this.extractIdFromPath(req);
      const permission = await this.permissionRoleService.updatePermission(
        permissionId,
        validatedData,
        req.context!
      );
      return createSuccessResponse(permission);
    });
  }

  /**
   * DELETE /api/v1/permissions/{id} - Delete permission
   */
  deletePermission() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const permissionId = this.extractIdFromPath(req);
      await this.permissionRoleService.deletePermission(permissionId, req.context!);
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * GET /api/v1/permissions/categories - Get permissions grouped by categories
   */
  getPermissionCategories() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const result = await this.permissionRoleService.listPermissions(
        { categorize: true },
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * GET /api/v1/permissions/usage-analytics - Get permission usage analytics
   */
  getPermissionUsageAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const analytics = await this.permissionRoleService.getPermissionUsageAnalytics(req.context!);
      return createSuccessResponse(analytics);
    });
  }

  // =============================================================================
  // ROLE ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/roles - List roles with advanced filtering
   */
  listRoles() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read'),
      withQueryValidation(roleListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'role_name';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      const listOptions = {
        page,
        limit,
        filters: validatedQuery,
        sort,
        order
      };

      const result = await this.permissionRoleService.listRoles(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters: validatedQuery,
          resource: 'role'
        }
      );
    });
  }

  /**
   * GET /api/v1/roles/{id} - Get role by ID with optional permissions
   */
  getRoleById() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const roleId = this.extractIdFromPath(req);
      const url = new URL(req.url);
      const includePermissions = url.searchParams.get('include_permissions') === 'true';
      
      const role = await this.permissionRoleService.getRoleById(
        roleId,
        req.context!,
        includePermissions
      );
      
      if (!role) {
        throw new NotFoundError('Role not found');
      }

      return createSuccessResponse(role);
    });
  }

  /**
   * POST /api/v1/roles - Create new role
   */
  createRole() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'create'),
      withValidation(createRoleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateRoleData) => {
      const role = await this.permissionRoleService.createRole(validatedData, req.context!);
      return createSuccessResponse(role, 201);
    });
  }

  /**
   * PUT /api/v1/roles/{id} - Update role
   */
  updateRole() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'update'),
      withValidation(updateRoleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateRoleData) => {
      const roleId = this.extractIdFromPath(req);
      const role = await this.permissionRoleService.updateRole(roleId, validatedData, req.context!);
      return createSuccessResponse(role);
    });
  }

  /**
   * DELETE /api/v1/roles/{id} - Delete role
   */
  deleteRole() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const roleId = this.extractIdFromPath(req);
      await this.permissionRoleService.deleteRole(roleId, req.context!);
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * GET /api/v1/roles/usage-analytics - Get role usage analytics
   */
  getRoleUsageAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const analytics = await this.permissionRoleService.getRoleUsageAnalytics(req.context!);
      return createSuccessResponse(analytics);
    });
  }

  // =============================================================================
  // ROLE PERMISSION MANAGEMENT ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/roles/{id}/permissions - Get permissions for a role
   */
  getRolePermissions() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const roleId = this.extractIdFromPath(req);
      const permissions = await this.permissionRoleService.getRolePermissions(roleId, req.context!);
      return createSuccessResponse(permissions);
    });
  }

  /**
   * POST /api/v1/roles/{id}/permissions - Assign permissions to role
   */
  assignPermissionsToRole() {
    const permissionIdsSchema = z.object({
      permission_ids: z.array(z.string().uuid()).min(1).max(100)
    });

    const middleware = compose(
      withAuth,
      withPermission('role', 'update'),
      withValidation(permissionIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { permission_ids: string[] }) => {
      const roleId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.assignPermissionsToRole(
        roleId,
        validatedData.permission_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * PUT /api/v1/roles/{id}/permissions - Replace role permissions
   */
  replaceRolePermissions() {
    const permissionIdsSchema = z.object({
      permission_ids: z.array(z.string().uuid()).max(200)
    });

    const middleware = compose(
      withAuth,
      withPermission('role', 'update'),
      withValidation(permissionIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { permission_ids: string[] }) => {
      const roleId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.replaceRolePermissions(
        roleId,
        validatedData.permission_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * DELETE /api/v1/roles/{id}/permissions - Remove permissions from role
   */
  removePermissionsFromRole() {
    const permissionIdsSchema = z.object({
      permission_ids: z.array(z.string().uuid()).min(1).max(100)
    });

    const middleware = compose(
      withAuth,
      withPermission('role', 'update'),
      withValidation(permissionIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { permission_ids: string[] }) => {
      const roleId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.removePermissionsFromRole(
        roleId,
        validatedData.permission_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  // =============================================================================
  // USER ROLE MANAGEMENT ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/users/{id}/roles - Get roles for a user
   */
  getUserRoles() {
    const middleware = compose(
      withAuth,
      withPermission('user', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const userId = this.extractIdFromPath(req);
      const roles = await this.permissionRoleService.getUserRoles(userId, req.context!);
      return createSuccessResponse(roles);
    });
  }

  /**
   * POST /api/v1/users/{id}/roles - Assign roles to user
   */
  assignRolesToUser() {
    const roleIdsSchema = z.object({
      role_ids: z.array(z.string().uuid()).min(1).max(10)
    });

    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(roleIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { role_ids: string[] }) => {
      const userId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.assignRolesToUser(
        userId,
        validatedData.role_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * PUT /api/v1/users/{id}/roles - Replace user roles
   */
  replaceUserRoles() {
    const roleIdsSchema = z.object({
      role_ids: z.array(z.string().uuid()).max(10)
    });

    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(roleIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { role_ids: string[] }) => {
      const userId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.replaceUserRoles(
        userId,
        validatedData.role_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * DELETE /api/v1/users/{id}/roles - Remove roles from user
   */
  removeRolesFromUser() {
    const roleIdsSchema = z.object({
      role_ids: z.array(z.string().uuid()).min(1).max(10)
    });

    const middleware = compose(
      withAuth,
      withPermission('user', 'update'),
      withValidation(roleIdsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { role_ids: string[] }) => {
      const userId = this.extractIdFromPath(req);
      const result = await this.permissionRoleService.removeRolesFromUser(
        userId,
        validatedData.role_ids,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * GET /api/v1/users-with-roles - List users with their roles
   */
  getUsersWithRoles() {
    const userRoleQuerySchema = z.object({
      page: z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
      search: z.string().optional(),
      is_inactive: z.coerce.boolean().optional(),
      sort: z.string().optional(),
      order: z.enum(['asc', 'desc']).optional()
    });

    const middleware = compose(
      withAuth,
      withPermission('user', 'read'),
      withQueryValidation(userRoleQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'username';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      const listOptions = {
        page,
        limit,
        filters: validatedQuery,
        sort,
        order
      };

      const result = await this.permissionRoleService.getUsersWithRoles(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters: validatedQuery,
          resource: 'user'
        }
      );
    });
  }

  // =============================================================================
  // PERMISSION CHECKING ENDPOINTS
  // =============================================================================

  /**
   * POST /api/v1/permissions/check - Check multiple permissions for a user
   */
  checkUserPermissions() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read'),
      withValidation(permissionChecksSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: PermissionChecksData) => {
      const userId = validatedData.user_id || req.context!.userId;
      const results = await this.permissionRoleService.checkUserPermissions(
        userId,
        validatedData.permissions,
        req.context!
      );
      
      return createSuccessResponse({
        user_id: userId,
        results,
        checked_at: new Date().toISOString()
      });
    });
  }

  /**
   * GET /api/v1/users/{id}/permissions/check/{resource}/{action} - Check single permission
   */
  checkSingleUserPermission() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const userId = pathParts[4]; // /api/v1/users/{id}/permissions/check/{resource}/{action}
      const resource = pathParts[7];
      const action = pathParts[8];

      if (!resource || !action) {
        throw new ValidationError('Resource and action are required');
      }

      const result = await this.permissionRoleService.checkUserPermission(
        userId,
        resource,
        action,
        req.context!
      );
      
      return createSuccessResponse(result);
    });
  }

  // =============================================================================
  // ANALYTICS ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/access-control/metrics - Get comprehensive access control metrics
   */
  getAccessControlMetrics() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const metrics = await this.permissionRoleService.getAccessControlMetrics(req.context!);
      return createSuccessResponse(metrics);
    });
  }

  // =============================================================================
  // BULK OPERATION ENDPOINTS
  // =============================================================================

  /**
   * POST /api/v1/roles/bulk - Bulk create roles
   */
  bulkCreateRoles() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'create'),
      withValidation(bulkCreateRolesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkCreateRolesData) => {
      const roles = await this.permissionRoleService.bulkCreateRoles(validatedData, req.context!);
      return createSuccessResponse({
        success: true,
        message: `Successfully created ${roles.length} roles`,
        created_roles: roles
      });
    });
  }

  /**
   * PUT /api/v1/roles/bulk - Bulk update roles
   */
  bulkUpdateRoles() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'update'),
      withValidation(bulkUpdateRolesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkUpdateRolesData) => {
      const roles = await this.permissionRoleService.bulkUpdateRoles(validatedData, req.context!);
      return createSuccessResponse({
        success: true,
        message: `Successfully updated ${roles.length} roles`,
        updated_roles: roles
      });
    });
  }

  /**
   * DELETE /api/v1/roles/bulk - Bulk delete roles
   */
  bulkDeleteRoles() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'delete'),
      withValidation(bulkDeleteRolesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkDeleteRolesData) => {
      const result = await this.permissionRoleService.bulkDeleteRoles(validatedData, req.context!);
      return createSuccessResponse(result);
    });
  }

  // =============================================================================
  // FEATURE TOGGLE ENDPOINTS
  // =============================================================================

  /**
   * POST /api/v1/features/access-check - Check feature access for user
   */
  checkFeatureAccess() {
    const middleware = compose(
      withAuth,
      withPermission('permission', 'read'),
      withValidation(featureAccessCheckSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: FeatureAccessCheck) => {
      const userId = validatedData.user_id || req.context!.userId;
      const result = await this.permissionRoleService.checkFeatureAccess(
        userId,
        validatedData.feature_name,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  // =============================================================================
  // ROLE TEMPLATE ENDPOINTS
  // =============================================================================

  /**
   * GET /api/v1/roles/templates - Get role templates
   */
  getRoleTemplates() {
    const middleware = compose(
      withAuth,
      withPermission('role', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const templates = await this.permissionRoleService.getRoleTemplates(req.context!);
      return createSuccessResponse(templates);
    });
  }

  /**
   * POST /api/v1/roles/{id}/clone - Clone a role
   */
  cloneRole() {
    const cloneDataSchema = z.object({
      new_role_name: z.string().min(1).max(100),
      new_description: z.string().max(500).optional(),
      copy_permissions: z.boolean().default(true)
    });

    const middleware = compose(
      withAuth,
      withPermission('role', 'create'),
      withValidation(cloneDataSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const sourceRoleId = this.extractIdFromPath(req);
      const clonedRole = await this.permissionRoleService.cloneRole(
        sourceRoleId,
        validatedData.new_role_name,
        validatedData.new_description,
        validatedData.copy_permissions,
        req.context!
      );
      return createSuccessResponse(clonedRole, 201);
    });
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Enhanced error handling for RBAC operations
   */
  private handleRbacError(error: any, operation: string): never {
    if (error.message.includes('not found')) {
      throw new NotFoundError(error.message);
    }
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      throw new ValidationError(error.message);
    }
    if (error.message.includes('currently assigned') || error.message.includes('in use')) {
      throw new ValidationError(error.message);
    }
    if (error.message.includes('permission denied') || error.message.includes('forbidden')) {
      throw new ForbiddenError(error.message);
    }
    
    // Log unexpected errors
    console.error(`RBAC ${operation} error:`, error);
    throw error;
  }

  /**
   * Extract multiple IDs from nested paths
   */
  private extractNestedIds(req: ApiRequest, ...resources: string[]): string[] {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const ids: string[] = [];
    
    for (const resource of resources) {
      const index = pathParts.indexOf(resource);
      if (index === -1 || index + 1 >= pathParts.length) {
        throw new ValidationError(`${resource} ID not found in path`);
      }
      ids.push(pathParts[index + 1]);
    }
    
    return ids;
  }

  /**
   * Create HATEOAS links for resources
   */
  private createHateoasLinks(resourceType: string, id: string, actions: string[] = []): Record<string, any> {
    const baseUrl = `/api/v1/${resourceType}s/${id}`;
    const links: Record<string, any> = {
      self: { rel: 'self', href: baseUrl }
    };

    // Standard CRUD operations
    if (actions.includes('update') || actions.length === 0) {
      links.edit = { rel: 'edit', href: baseUrl, method: 'PUT' };
    }
    if (actions.includes('delete') || actions.length === 0) {
      links.delete = { rel: 'delete', href: baseUrl, method: 'DELETE' };
    }

    // Resource-specific links
    if (resourceType === 'role') {
      links.permissions = { rel: 'permissions', href: `${baseUrl}/permissions` };
      links.users = { rel: 'users', href: `${baseUrl}/users` };
      links.clone = { rel: 'clone', href: `${baseUrl}/clone`, method: 'POST' };
    } else if (resourceType === 'permission') {
      links.roles = { rel: 'roles', href: `${baseUrl}/roles` };
    }

    links.collection = { rel: 'collection', href: `/api/v1/${resourceType}s` };
    
    return links;
  }
}
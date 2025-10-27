/**
 * API Permission Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { PermissionRoleService } from '@product/api/services/PermissionRoleService';
import { 
  createPermissionSchema,
  updatePermissionSchema,
  permissionListQuerySchema
} from '@product/api/schemas/permissionRoleSchemas';
import { 
  runWithTenant 
} from '@server/lib/db';
import {
  ApiRequest,
  AuthenticatedApiRequest,
  NotFoundError,
  ConflictError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';

export class ApiPermissionController extends ApiBaseController {
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
  }

  /**
   * Override list to use listPermissions instead of list
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'resource';
          const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';
          
          // Get filters
          const filters: any = {};
          const resource = url.searchParams.get('resource');
          const action = url.searchParams.get('action');
          if (resource) filters.resource = resource;
          if (action) filters.action = action;

          const listOptions = { page, limit, filters, sort, order };
          const result = await this.permissionRoleService.listPermissions(listOptions, apiRequest.context);
          
          // Check if result is categorized or regular list
          if ('categories' in result) {
            return createSuccessResponse(result);
          } else {
            return createPaginatedResponse(
              result.data,
              result.total,
              page,
              limit,
              { sort, order, filters }
            );
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override create to use createPermission
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Parse and validate request body
          const body = await req.json();
          const validatedData = createPermissionSchema.parse(body);

          // Create permission
          try {
            const result = await this.permissionRoleService.createPermission(validatedData, apiRequest.context);
            return createSuccessResponse(result, 201);
          } catch (error: any) {
            if (error.message && error.message.includes('already exists')) {
              throw new ConflictError(error.message);
            }
            throw error;
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override update to use updatePermission
   */
  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          const validatedData = updatePermissionSchema.parse(body);

          // Update permission
          const result = await this.permissionRoleService.updatePermission(id, validatedData, apiRequest.context);
          
          if (!result) {
            throw new NotFoundError('Permission not found');
          }
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override delete to use deletePermission
   */
  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);

          // Delete permission
          await this.permissionRoleService.deletePermission(id, apiRequest.context);
          
          return createSuccessResponse(null, 204);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override getById to use getPermissionById
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);

          // Get permission by ID
          const result = await this.permissionRoleService.getPermissionById(id, apiRequest.context);
          
          if (!result) {
            throw new NotFoundError('Permission not found');
          }
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get permission categories
   */
  getCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Get permissions with categorize flag
          const result = await this.permissionRoleService.listPermissions(
            { categorize: true }, 
            apiRequest.context
          );
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
  
  /**
   * Get roles that have a specific permission
   */
  getRolesByPermission() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);

          // Get roles using this permission
          const roles = await this.permissionRoleService.getRolesByPermission(id, apiRequest.context!);
          
          return createSuccessResponse(roles);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Check multiple permissions for a user
   */
  checkUserPermissions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse and validate request body
          const body = await req.json();
          const { user_id, permissions } = body;
          
          if (!Array.isArray(permissions)) {
            throw new ValidationError('permissions must be an array');
          }

          const userId = user_id || apiRequest.context!.userId;
          
          // Check permissions using the service
          const results = await this.permissionRoleService.checkUserPermissions(
            userId,
            permissions,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            user_id: userId,
            results,
            checked_at: new Date().toISOString()
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Check feature access for a user
   */
  checkFeatureAccess() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse and validate request body
          const body = await req.json();
          const { user_id, feature_name } = body;
          
          if (!feature_name) {
            throw new ValidationError('feature_name is required');
          }

          const userId = user_id || apiRequest.context!.userId;
          
          // Check feature access using the service
          const result = await this.permissionRoleService.checkFeatureAccess(
            userId,
            feature_name,
            apiRequest.context!
          );
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
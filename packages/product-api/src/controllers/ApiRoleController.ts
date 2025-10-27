/**
 * API Role Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { PermissionRoleService as RoleService } from '@product/api/services/PermissionRoleService';
import { 
  createRoleSchema,
  updateRoleSchema,
  roleListQuerySchema,
  assignPermissionsToRoleSchema,
  cloneRoleSchema
} from '@product/api/schemas/permissionRoleSchemas';
import { 
  ApiKeyServiceForApi 
} from '@server/lib/services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '@product/actions/user-actions/findUserByIdForApi';
import { 
  runWithTenant 
} from '@server/lib/db';
import { 
  getConnection 
} from '@server/lib/db/db';
import { 
  hasPermission 
} from '@server/lib/auth/rbac';
import {
  ApiRequest,
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiRoleController extends ApiBaseController {
  private roleService: RoleService;

  constructor() {
    const roleService = new RoleService();
    
    super(roleService, {
      resource: 'role',
      createSchema: createRoleSchema,
      updateSchema: updateRoleSchema,
      querySchema: roleListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.roleService = roleService;
  }

  /**
   * Override create to use createRole method that returns full role data
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Parse and validate request body
          const body = await req.json();
          let createData;
          try {
            createData = createRoleSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Invalid role data', error.errors);
            }
            throw error;
          }

          // Create role using the proper method
          try {
            const role = await this.roleService.createRole(createData, apiRequest.context);
            return createSuccessResponse(role, 201);
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
   * Override update to use updateRole method that returns full role data
   */
  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Extract role ID from path
        const roleId = await this.extractIdFromPath(apiRequest);

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Parse and validate request body
          const body = await req.json();
          let updateData;
          try {
            updateData = updateRoleSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Invalid update data', error.errors);
            }
            throw error;
          }

          // Update role using the proper method
          const role = await this.roleService.updateRole(roleId, updateData, apiRequest.context);

          return createSuccessResponse(role);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override getById to use getRoleById method that returns full role data
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Extract role ID from path
        const roleId = await this.extractIdFromPath(apiRequest);

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Get role using the proper method
          const role = await this.roleService.getRoleById(roleId, apiRequest.context, false);
          
          if (!role) {
            throw new NotFoundError('Role not found');
          }

          return createSuccessResponse(role);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override list to use listRoles method that returns full role data
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          let validatedQuery = {};
          if (this.options.querySchema) {
            validatedQuery = this.validateQuery(apiRequest, this.options.querySchema);
          }

          // Parse pagination parameters
          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'role_name';
          const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

          const filters: any = { ...validatedQuery };
          delete filters.page;
          delete filters.limit;
          delete filters.sort;
          delete filters.order;

          const listOptions = { page, limit, filters, sort, order };
          const result = await this.roleService.listRoles(listOptions, apiRequest.context);
          
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit,
            { sort, order, filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override delete to use the custom deleteRole method
   */
  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          const resource = await this.roleService.getById(id, apiRequest.context);
          
          if (!resource) {
            throw new NotFoundError('Role not found');
          }
          
          await this.roleService.deleteRole(id, apiRequest.context);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get role templates
   */
  getTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Check permissions
        await this.checkPermission(apiRequest, 'read');

        // Get templates within tenant context
        const templates = await runWithTenant(apiRequest.context.tenant, async () => {
          return await this.roleService.getRoleTemplates(apiRequest.context);
        });

        return createSuccessResponse(templates);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Clone a role
   */
  cloneRole() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Extract role ID from path
        const roleId = await this.extractIdFromPath(apiRequest);

        // Check permissions
        await this.checkPermission(apiRequest, 'create');

        // Parse and validate request body
        const body = await req.json();
        let cloneData;
        try {
          cloneData = cloneRoleSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid clone data', error.errors);
          }
          throw error;
        }

        // Clone role within tenant context
        const clonedRole = await runWithTenant(apiRequest.context.tenant, async () => {
          return await this.roleService.cloneRole(
            roleId,
            cloneData.new_role_name,
            cloneData.new_description,
            cloneData.copy_permissions,
            apiRequest.context
          );
        });

        return createSuccessResponse(clonedRole, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get role permissions
   */
  getPermissions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Extract role ID from path
        const roleId = await this.extractIdFromPath(apiRequest);

        // Check permissions
        await this.checkPermission(apiRequest, 'read');

        // Get permissions within tenant context
        const permissions = await runWithTenant(apiRequest.context.tenant, async () => {
          return await this.roleService.getRolePermissions(roleId, apiRequest.context);
        });

        return createSuccessResponse(permissions);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Assign permissions to role
   */
  assignPermissions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Extract role ID from path
        const roleId = await this.extractIdFromPath(apiRequest);

        // Check permissions
        await this.checkPermission(apiRequest, 'update');

        // Parse and validate request body
        const body = await req.json();
        let permissionsData;
        try {
          permissionsData = assignPermissionsToRoleSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid permissions data', error.errors);
          }
          throw error;
        }

        // Assign permissions within tenant context
        const updatedRole = await runWithTenant(apiRequest.context.tenant, async () => {
          await this.roleService.assignPermissionsToRole(
            roleId, 
            permissionsData.permission_ids, 
            apiRequest.context
          );
          // Return the updated role with permissions
          return await this.roleService.getRoleById(roleId, apiRequest.context, true);
        });

        return createSuccessResponse(updatedRole);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk create roles
   */
  bulkCreate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Check permissions
        await this.checkPermission(apiRequest, 'create');

        // Parse request body
        const body = await req.json();
        
        if (!Array.isArray(body.roles)) {
          throw new ValidationError('Invalid request: roles must be an array');
        }

        // Create roles within tenant context
        const createdRoles = await runWithTenant(apiRequest.context.tenant, async () => {
          const results: { success: boolean; data?: any; error?: string }[] = [];
          for (const roleData of body.roles) {
            try {
              const validatedData = createRoleSchema.parse(roleData);
              const role = await this.roleService.create(validatedData, apiRequest.context);
              results.push({ success: true, data: role });
            } catch (error) {
              results.push({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error',
                data: roleData 
              });
            }
          }
          return results;
        });

        return createSuccessResponse(createdRoles);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get comprehensive access control metrics
   */
  getAccessControlMetrics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Get metrics using the service
          const metrics = await this.roleService.getAccessControlMetrics(apiRequest.context);
          
          return createSuccessResponse(metrics);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}

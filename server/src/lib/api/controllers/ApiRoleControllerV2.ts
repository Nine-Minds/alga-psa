/**
 * API Role Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseControllerV2 } from './ApiBaseControllerV2';
import { RoleService } from '../services/RoleService';
import { 
  createRoleSchema,
  updateRoleSchema,
  roleListQuerySchema,
  assignPermissionsSchema,
  cloneRoleSchema
} from '../schemas/role';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '../../actions/user-actions/findUserByIdForApi';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiRoleControllerV2 extends ApiBaseControllerV2 {
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
   * Get role templates
   */
  getTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'role:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read role templates');
        }

        // Get templates within tenant context
        const templates = await runWithTenant(tenantId!, async () => {
          return await this.roleService.getRoleTemplates({
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
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
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Extract role ID from path
        const roleId = this.extractIdFromPath(req.url, 'roles');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasCreatePermission = await hasPermission(
          db,
          user.user_id,
          'role:create',
          tenantId!
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create roles');
        }

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
        const clonedRole = await runWithTenant(tenantId!, async () => {
          return await this.roleService.cloneRole(roleId, cloneData, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
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
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Extract role ID from path
        const roleId = this.extractIdFromPath(req.url, 'roles');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'role:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read role permissions');
        }

        // Get permissions within tenant context
        const permissions = await runWithTenant(tenantId!, async () => {
          return await this.roleService.getRolePermissions(roleId, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
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
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Extract role ID from path
        const roleId = this.extractIdFromPath(req.url, 'roles');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          db,
          user.user_id,
          'role:update',
          tenantId!
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update role permissions');
        }

        // Parse and validate request body
        const body = await req.json();
        let permissionsData;
        try {
          permissionsData = assignPermissionsSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid permissions data', error.errors);
          }
          throw error;
        }

        // Assign permissions within tenant context
        const updatedRole = await runWithTenant(tenantId!, async () => {
          return await this.roleService.assignPermissions(roleId, permissionsData.permissions, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
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
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasCreatePermission = await hasPermission(
          db,
          user.user_id,
          'role:create',
          tenantId!
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create roles');
        }

        // Parse request body
        const body = await req.json();
        
        if (!Array.isArray(body.roles)) {
          throw new ValidationError('Invalid request: roles must be an array');
        }

        // Create roles within tenant context
        const createdRoles = await runWithTenant(tenantId!, async () => {
          const results = [];
          for (const roleData of body.roles) {
            try {
              const validatedData = createRoleSchema.parse(roleData);
              const role = await this.roleService.create(validatedData, {
                user,
                tenant: tenantId!,
                permissions: user.roles || []
              });
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
}
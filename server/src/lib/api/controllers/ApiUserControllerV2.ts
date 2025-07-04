/**
 * API User Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseControllerV2 } from './ApiBaseControllerV2';
import { UserService } from '../services/UserService';
import { 
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
  userSearchSchema,
  userExportQuerySchema,
  changePasswordSchema,
  userActivityFilterSchema
} from '../schemas/userSchemas';
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

export class ApiUserControllerV2 extends ApiBaseControllerV2 {
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
  }

  /**
   * Search users
   */
  search() {
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'user', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read user');
          }

          // Validate query
          let validatedQuery;
          try {
            const url = new URL(req.url);
            const query: Record<string, any> = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            validatedQuery = userSearchSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.userService.searchUsers(
            validatedQuery,
            apiRequest.context!
          );

          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user statistics
   */
  stats() {
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'user', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read user');
          }

          const stats = await this.userService.getUserStats(apiRequest.context!);
          
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user activity
   */
  activity() {
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'user', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read user');
          }

          // Validate query
          let validatedQuery;
          try {
            const url = new URL(req.url);
            const query: Record<string, any> = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            validatedQuery = userActivityFilterSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.userService.getUserActivity(
            validatedQuery,
            apiRequest.context!
          );

          return createPaginatedResponse(
            result.data,
            result.total,
            validatedQuery.page || 1,
            validatedQuery.limit || 25
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Change user password
   */
  changePassword() {
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract user ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const usersIndex = pathParts.findIndex(part => part === 'users');
        const targetUserId = pathParts[usersIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions - users can change their own password, admins can change any
          const knex = await getConnection(tenantId!);
          const canChangeAny = await hasPermission(user, 'user', 'update', knex);
          
          if (targetUserId !== user.user_id && !canChangeAny) {
            throw new ForbiddenError('Permission denied: Cannot change password for other users');
          }

          // Validate data
          let data;
          try {
            const body = await req.json();
            data = changePasswordSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          await this.userService.changePassword(
            targetUserId,
            data,
            apiRequest.context!
          );
          
          return createSuccessResponse({ message: 'Password changed successfully' });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user permissions
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract user ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const usersIndex = pathParts.findIndex(part => part === 'users');
        const targetUserId = pathParts[usersIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'user', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read user');
          }

          const permissions = await this.userService.getUserPermissions(
            targetUserId,
            apiRequest.context!
          );
          
          return createSuccessResponse(permissions);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user roles
   */
  getRoles() {
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

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract user ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const usersIndex = pathParts.findIndex(part => part === 'users');
        const targetUserId = pathParts[usersIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'user', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read user');
          }

          const roles = await this.userService.getUserRoles(
            targetUserId,
            apiRequest.context!
          );
          
          return createSuccessResponse(roles);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
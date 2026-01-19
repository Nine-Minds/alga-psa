/**
 * API User Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { UserService, UserActivityFilter } from '../services/UserService';
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
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import { createSystemContext } from '../services/SystemContext';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError,
  withApiKeyAuth,
  withQueryValidation
} from '../middleware/apiMiddleware';
import { ZodError, z } from 'zod';

export class ApiUserController extends ApiBaseController {
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
    return withApiKeyAuth({ allowNmStore: true, requireTenantForNmStore: true })(
      withQueryValidation(userSearchSchema)(
        async (req: ApiRequest, validatedQuery: any): Promise<NextResponse> => {
          try {
            const tenantId = req.context!.tenant;
            return await runWithTenant(tenantId, async () => {
              const serviceContext = req.context?.kind === 'system'
                ? createSystemContext(tenantId)
                : { userId: req.context!.userId, tenant: tenantId, user: req.context!.user };

              const result = await this.userService.searchUsers(
                validatedQuery,
                serviceContext as any
              );

              return createSuccessResponse(result);
            });
          } catch (error) {
            return handleApiError(error);
          }
        }
      )
    );
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

          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // Transform date strings to Date objects for the service
          const filter: UserActivityFilter = {
            ...validatedQuery,
            from_date: validatedQuery.from_date ? new Date(validatedQuery.from_date) : undefined,
            to_date: validatedQuery.to_date ? new Date(validatedQuery.to_date) : undefined
          };

          const result = await this.userService.getUserActivity(
            filter,
            apiRequest.context!,
            page,
            limit
          );

          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit
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
            { ...data, user_id: targetUserId },
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

          const targetUser = await this.userService.getById(targetUserId, apiRequest.context!, {
            includePermissions: true,
            includeRoles: true
          });

          if (!targetUser) {
            throw new NotFoundError('User not found');
          }
          
          return createSuccessResponse({
            user_id: targetUserId,
            permissions: targetUser.permissions || [],
            roles: targetUser.roles || [],
            effective_permissions: targetUser.permissions || [],
            _links: {
              self: `/api/v1/users/${targetUserId}/permissions`,
              user: `/api/v1/users/${targetUserId}`,
              roles: `/api/v1/users/${targetUserId}/roles`
            }
          });
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

  /**
   * Assign roles to user
   */
  assignRoles() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          const { role_ids } = body;
          
          if (!Array.isArray(role_ids)) {
            throw new ValidationError('role_ids must be an array');
          }

          // Assign roles
          const result = await this.userService.assignRoles(
            targetUserId,
            role_ids,
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
   * Remove roles from user
   */
  removeRoles() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          const { role_ids } = body;
          
          if (!Array.isArray(role_ids)) {
            throw new ValidationError('role_ids must be an array');
          }

          // Remove roles
          const result = await this.userService.removeRoles(
            targetUserId,
            role_ids,
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
   * Replace user roles
   */
  replaceRoles() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          const { role_ids } = body;
          
          if (!Array.isArray(role_ids)) {
            throw new ValidationError('role_ids must be an array');
          }

          // Replace roles - use removeRoles followed by assignRoles
          const knex = await getConnection(apiRequest.context!.tenant);
          await knex.transaction(async (trx) => {
            // First remove all existing roles
            await trx('user_roles')
              .where('user_id', targetUserId)
              .where('tenant', apiRequest.context!.tenant)
              .delete();
            
            // Then assign new roles if any
            if (role_ids.length > 0) {
              const userRoles = role_ids.map(roleId => ({
                tenant: apiRequest.context!.tenant,
                user_id: targetUserId,
                role_id: roleId
              }));
              await trx('user_roles').insert(userRoles);
            }
          });
          
          // Get updated roles
          const updatedRoles = await this.userService.getUserRoles(
            targetUserId,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            success: true,
            message: `Successfully replaced user roles`,
            roles: updatedRoles
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List users with their roles
   */
  listUsersWithRoles() {
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
          const search = url.searchParams.get('search') || undefined;
          const is_inactive = url.searchParams.get('is_inactive') === 'true';
          const sort = url.searchParams.get('sort') || 'username';
          const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

          const listOptions = {
            page,
            limit,
            filters: { search, is_inactive },
            sort,
            order
          };

          // Get users list with basic info
          const result = await this.userService.list(listOptions, apiRequest.context!);
          
          // Enhance each user with their roles
          const knex = await getConnection(apiRequest.context!.tenant);
          const usersWithRoles = await Promise.all(
            result.data.map(async (user: any) => {
              const roles = await knex('user_roles as ur')
                .join('roles as r', function() {
                  this.on('ur.role_id', '=', 'r.role_id')
                      .andOn('ur.tenant', '=', 'r.tenant');
                })
                .where('ur.user_id', user.user_id)
                .where('ur.tenant', apiRequest.context!.tenant)
                .select('r.role_id', 'r.role_name', 'r.description')
                .orderBy('r.role_name');
              
              return {
                ...user,
                roles
              };
            })
          );
          
          return createPaginatedResponse(
            usersWithRoles,
            result.total,
            page,
            limit,
            { sort, order, filters: listOptions.filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Enable 2FA for user
   */
  enable2FA() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Get data from request body
          const data = await this.validateData(apiRequest, z.object({
            secret: z.string(),
            token: z.string()
          }));

          // Enable 2FA
          const result = await this.userService.enable2FA(
            targetUserId, 
            data.secret,
            data.token,
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
   * Disable 2FA for user
   */
  disable2FA() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Disable 2FA
          const result = await this.userService.disable2FA(targetUserId, apiRequest.context!);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user activity
   */
  getUserActivity() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Parse query parameters
          const url = new URL(apiRequest.url);
          const activityType = url.searchParams.get('activity_type');
          const filter: UserActivityFilter = {
            user_id: targetUserId,
            from_date: url.searchParams.get('from_date') ? new Date(url.searchParams.get('from_date')!) : undefined,
            to_date: url.searchParams.get('to_date') ? new Date(url.searchParams.get('to_date')!) : undefined,
            activity_type: activityType ? [activityType] : undefined
          };

          // Get user activity - get page and limit from query params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.userService.getUserActivity(
            filter,
            apiRequest.context!,
            page,
            limit
          );
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Upload user avatar
   */
  uploadAvatar() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Get form data
          const formData = await req.formData();
          const file = formData.get('avatar') as File;

          if (!file) {
            throw new ValidationError('Avatar file is required');
          }

          // Upload avatar
          const result = await this.userService.uploadAvatar(
            targetUserId,
            file,
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
   * Delete user avatar
   */
  deleteAvatar() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Delete avatar
          const result = await this.userService.deleteAvatar(targetUserId, apiRequest.context!);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get user preferences
   */
  getUserPreferences() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Get preferences
          const result = await this.userService.getUserPreferences(
            targetUserId,
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
   * Update user preferences
   */
  updateUserPreferences() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();

          // Update preferences
          const result = await this.userService.updateUserPreferences(
            targetUserId,
            body,
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
   * Get user teams
   */
  getUserTeams() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Extract user ID from path
          const targetUserId = await this.extractIdFromPath(apiRequest);

          // Get user teams
          const result = await this.userService.getUserTeams(
            targetUserId,
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

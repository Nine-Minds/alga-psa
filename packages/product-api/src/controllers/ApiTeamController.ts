/**
 * API Team Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { TeamService } from '@product/api/services/TeamService';
import { 
  createTeamSchema,
  updateTeamSchema,
  teamListQuerySchema,
  addTeamMemberSchema,
  removeTeamMemberSchema,
  bulkAddTeamMembersSchema,
  assignManagerSchema,
  teamAnalyticsQuerySchema,
  advancedTeamSearchSchema
} from '@product/api/schemas/teamSchemas';
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
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiTeamController extends ApiBaseController {
  private teamService: TeamService;

  constructor() {
    const teamService = new TeamService();
    
    super(teamService, {
      resource: 'team',
      createSchema: createTeamSchema,
      updateSchema: updateTeamSchema,
      querySchema: teamListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.teamService = teamService;
  }

  /**
   * Search teams with advanced filters
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

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read teams');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let filters;
        try {
          filters = advancedTeamSearchSchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid search parameters', error.errors);
          }
          throw error;
        }

        // Extract options and filters outside the callback
        const options = {
          page: filters.pagination?.page || 1,
          limit: filters.pagination?.limit || 25,
          sort: filters.sort?.field || 'team_name',
          order: filters.sort?.direction as 'asc' | 'desc' || 'asc',
          includeHierarchy: false,
          includeMembers: false,
          includeProjects: false
        };

        const searchFilters = {
          ...filters.filters,
          query: filters.query
        };

        // Execute search within tenant context
        const results = await runWithTenant(tenantId!, async () => {
          return await this.teamService.searchTeams(searchFilters, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          }, options);
        });

        return createPaginatedResponse(
          results.data,
          results.total,
          options.page,
          options.limit,
          { sort: options.sort, order: options.order, filters: searchFilters }
        );
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get team statistics
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

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team statistics');
        }

        // Get statistics within tenant context
        const stats = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamStatistics({
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(stats);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get team hierarchy
   */
  getHierarchy() {
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
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team hierarchy');
        }

        // Get team ID from URL
        const url = new URL(req.url);
        const teamId = url.pathname.split('/').pop();
        
        if (!teamId) {
          throw new ValidationError('Team ID is required');
        }

        // Get hierarchy within tenant context
        const hierarchy = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getFullHierarchy(teamId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(hierarchy);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get team members
   */
  getMembers() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team members');
        }

        // Get members within tenant context
        const members = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamMembers(teamId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(members);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Add team member
   */
  addMember() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team members');
        }

        // Parse and validate request body
        const body = await req.json();
        let memberData;
        try {
          memberData = addTeamMemberSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid member data', error.errors);
          }
          throw error;
        }

        // Add member within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.teamService.addTeamMember(teamId, memberData, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(result, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Remove team member
   */
  removeMember() {
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

        // Extract IDs from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const teamsIndex = pathParts.findIndex(part => part === 'teams');
        const teamId = pathParts[teamsIndex + 1];
        const membersIndex = pathParts.findIndex(part => part === 'members');
        const userId = pathParts[membersIndex + 1];

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team members');
        }

        // Remove member within tenant context
        await runWithTenant(tenantId!, async () => {
          await this.teamService.removeTeamMember(teamId, userId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk add team members
   */
  bulkAddMembers() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team members');
        }

        // Parse and validate request body
        const body = await req.json();
        let membersData;
        try {
          membersData = bulkAddTeamMembersSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid members data', error.errors);
          }
          throw error;
        }

        // Add members within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.teamService.bulkAddTeamMembers(teamId, membersData, {
            userId: user.user_id,
            tenant: tenantId!,
            user
          });
        });

        return createSuccessResponse(result);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Assign team manager
   */
  assignManager() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team manager');
        }

        // Parse and validate request body
        const body = await req.json();
        let managerData;
        try {
          managerData = assignManagerSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid manager data', error.errors);
          }
          throw error;
        }

        // Assign manager within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.teamService.assignManager(teamId, managerData.manager_id, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(result);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get team analytics
   */
  getAnalytics() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team analytics');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let filters;
        try {
          filters = teamAnalyticsQuerySchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid analytics parameters', error.errors);
          }
          throw error;
        }

        // Get analytics within tenant context
        const analytics = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamAnalytics(teamId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return createSuccessResponse(analytics);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get team projects
   */
  getProjects() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team projects');
        }

        // Get projects within tenant context
        const projects = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamProjects(teamId, {
            userId: user.user_id,
            tenant: tenantId!,
            user
          });
        });

        return createSuccessResponse(projects);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Grant team permission
   */
  grantPermission() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot grant team permissions');
        }

        // Parse and validate request body
        const body = await req.json();

        // Grant permission within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.teamService.grantPermission(
            teamId,
            body.resource || body.permission,
            body.action || 'access',
            {
              userId: user.user_id,
              tenant: tenantId!,
              user
            },
            body.expires_at ? new Date(body.expires_at) : undefined
          );
        });

        return createSuccessResponse(result, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List team permissions
   */
  listPermissions() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'team',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team permissions');
        }

        // Get permissions within tenant context
        const permissions = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamPermissions(teamId, {
            userId: user.user_id,
            tenant: tenantId!,
            user
          });
        });

        return createSuccessResponse(permissions);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Revoke team permission
   */
  revokePermission() {
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

        // Extract permission ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const permissionsIndex = pathParts.findIndex(part => part === 'permissions');
        
        if (permissionsIndex === -1 || permissionsIndex >= pathParts.length - 1) {
          throw new ValidationError('Invalid URL structure');
        }
        
        const permissionId = pathParts[permissionsIndex + 1];

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot revoke team permissions');
        }

        // Revoke permission within tenant context
        await runWithTenant(tenantId!, async () => {
          await this.teamService.revokePermission(permissionId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create team hierarchy
   */
  createHierarchy() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team hierarchy');
        }

        // Parse and validate request body
        const body = await req.json();

        // Create hierarchy within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.teamService.createHierarchy(
            teamId,
            body.parent_team_id,
            {
              userId: user.user_id,
              user,
              tenant: tenantId!
            }
          );
        });

        return createSuccessResponse(result, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Remove team from hierarchy
   */
  removeFromHierarchy() {
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

        // Extract team ID from path
        const teamId = await this.extractIdFromPath(req);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team hierarchy');
        }

        // Remove from hierarchy within tenant context
        await runWithTenant(tenantId!, async () => {
          await this.teamService.removeFromHierarchy(teamId, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk update teams
   */
  bulkUpdate() {
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
        const hasUpdatePermission = await hasPermission(
          user,
          'team',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update teams');
        }

        // Parse and validate request body
        const body = await req.json();

        // Bulk update within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          const bulkUpdates = body.team_ids.map((id: string) => ({
            id,
            data: body.updates
          }));
          
          return await this.teamService.bulkUpdate(
            bulkUpdates,
            {
              userId: user.user_id,
              user,
              tenant: tenantId!
            }
          );
        });

        return createSuccessResponse(result);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk delete teams
   */
  bulkDelete() {
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
        const hasDeletePermission = await hasPermission(
          user,
          'team',
          'delete',
          db
        );

        if (!hasDeletePermission) {
          throw new ForbiddenError('Permission denied: Cannot delete teams');
        }

        // Parse and validate request body
        const body = await req.json();

        // Bulk delete within tenant context
        await runWithTenant(tenantId!, async () => {
          await this.teamService.bulkDelete(body.team_ids, {
            userId: user.user_id,
            user,
            tenant: tenantId!
          });
        });

        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override extractIdFromPath to handle team-specific routes
   */
  protected async extractIdFromPath(req: ApiRequest): Promise<string> {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const teamIndex = pathParts.findIndex(part => part === 'teams');
    
    if (teamIndex === -1 || teamIndex >= pathParts.length - 1) {
      throw new ValidationError('Invalid URL structure');
    }
    
    const id = pathParts[teamIndex + 1];
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (id && !uuidRegex.test(id)) {
      throw new ValidationError('Invalid team ID format');
    }
    
    return id;
  }
}
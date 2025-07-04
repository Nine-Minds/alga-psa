/**
 * API Team Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseControllerV2 } from './ApiBaseControllerV2';
import { TeamService } from '../services/TeamService';
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
} from '../schemas/teamSchemas';
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

export class ApiTeamControllerV2 extends ApiBaseControllerV2 {
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
          db,
          user.user_id,
          'team:read',
          tenantId!
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

        // Execute search within tenant context
        const results = await runWithTenant(tenantId!, async () => {
          const options = {
            page: filters.page || 1,
            limit: filters.limit || 25,
            sort: filters.sort || 'team_name',
            order: filters.order as 'asc' | 'desc' || 'asc',
            includeHierarchy: filters.includeHierarchy,
            includeMembers: filters.includeMembers,
            includeProjects: filters.includeProjects
          };

          const searchFilters = {
            ...filters,
            page: undefined,
            limit: undefined,
            sort: undefined,
            order: undefined,
            includeHierarchy: undefined,
            includeMembers: undefined,
            includeProjects: undefined
          };

          return await this.teamService.searchTeams(searchFilters, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          }, options);
        });

        return createPaginatedResponse(results.data, {
          page: results.page || 1,
          limit: results.limit || 25,
          total: results.total
        });
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
          db,
          user.user_id,
          'team:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team statistics');
        }

        // Get statistics within tenant context
        const stats = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamStatistics({
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
          db,
          user.user_id,
          'team:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team hierarchy');
        }

        // Get hierarchy within tenant context
        const hierarchy = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getFullHierarchy({
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'team:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team members');
        }

        // Get members within tenant context
        const members = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamMembers(teamId, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          db,
          user.user_id,
          'team:update',
          tenantId!
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
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const pathParts = req.url.split('/');
        const teamsIndex = pathParts.findIndex(part => part === 'teams');
        const teamId = pathParts[teamsIndex + 1];
        const membersIndex = pathParts.findIndex(part => part === 'members');
        const userId = pathParts[membersIndex + 1];

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          db,
          user.user_id,
          'team:update',
          tenantId!
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update team members');
        }

        // Remove member within tenant context
        await runWithTenant(tenantId!, async () => {
          await this.teamService.removeTeamMember(teamId, userId, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          db,
          user.user_id,
          'team:update',
          tenantId!
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
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          db,
          user.user_id,
          'team:update',
          tenantId!
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
          return await this.teamService.assignManager(teamId, managerData.user_id, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'team:read',
          tenantId!
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
          return await this.teamService.getTeamAnalytics(teamId, filters, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
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
        const teamId = this.extractIdFromPath(req.url, 'teams');

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'team:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read team projects');
        }

        // Get projects within tenant context
        const projects = await runWithTenant(tenantId!, async () => {
          return await this.teamService.getTeamProjects(teamId, {
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
        });

        return createSuccessResponse(projects);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override extractIdFromPath to handle team-specific routes
   */
  protected extractIdFromPath(url: string, resource: string): string {
    const pathParts = url.split('/');
    const teamIndex = pathParts.findIndex(part => part === 'teams');
    
    if (teamIndex === -1 || teamIndex >= pathParts.length - 1) {
      throw new ValidationError('Invalid URL structure');
    }
    
    return pathParts[teamIndex + 1];
  }
}
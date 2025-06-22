/**
 * Team Controller
 * Comprehensive controller for team-related API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { TeamService, TeamServiceOptions, TeamSearchOptions } from '../services/TeamService';
import { 
  createTeamSchema,
  updateTeamSchema,
  teamListQuerySchema,
  addTeamMemberSchema,
  removeTeamMemberSchema,
  bulkAddTeamMembersSchema,
  bulkRemoveTeamMembersSchema,
  assignManagerSchema,
  updateTeamMemberRoleSchema,
  createTeamHierarchySchema,
  updateTeamHierarchySchema,
  grantTeamPermissionSchema,
  revokeTeamPermissionSchema,
  assignTeamToProjectSchema,
  updateTeamProjectAssignmentSchema,
  assignTeamToTaskSchema,
  teamAnalyticsQuerySchema,
  advancedTeamSearchSchema,
  bulkUpdateTeamsSchema,
  bulkDeleteTeamsSchema,
  bulkAssignManagerSchema,
  bulkTeamMemberOperationSchema,
  createTeamCommunicationChannelSchema,
  createTeamCollaborationWorkspaceSchema,
  scheduleTeamMeetingSchema,
  CreateTeamData,
  UpdateTeamData,
  TeamFilterData
} from '../schemas/teamSchemas';
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
  ConflictError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';

export class TeamController extends BaseController {
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
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    // Core CRUD endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams',
      method: 'GET',
      resource: 'team',
      action: 'list',
      description: 'List teams with filtering, search, and pagination',
      permissions: { resource: 'team', action: 'read' },
      querySchema: teamListQuerySchema,
      tags: ['teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams',
      method: 'POST',
      resource: 'team',
      action: 'create',
      description: 'Create a new team',
      permissions: { resource: 'team', action: 'create' },
      requestSchema: createTeamSchema,
      tags: ['teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team details by ID with optional extended information',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}',
      method: 'PUT',
      resource: 'team',
      action: 'update',
      description: 'Update team information',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: updateTeamSchema,
      tags: ['teams']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}',
      method: 'DELETE',
      resource: 'team',
      action: 'delete',
      description: 'Delete a team',
      permissions: { resource: 'team', action: 'delete' },
      tags: ['teams']
    });

    // Team member management endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/members',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team members',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'members']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/members',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Add member to team',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: addTeamMemberSchema,
      tags: ['teams', 'members']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/members/{userId}',
      method: 'DELETE',
      resource: 'team',
      action: 'update',
      description: 'Remove member from team',
      permissions: { resource: 'team', action: 'update' },
      tags: ['teams', 'members']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/members/bulk',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Bulk add members to team',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: bulkAddTeamMembersSchema,
      tags: ['teams', 'members', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/members/bulk',
      method: 'DELETE',
      resource: 'team',
      action: 'update',
      description: 'Bulk remove members from team',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: bulkRemoveTeamMembersSchema,
      tags: ['teams', 'members', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/manager',
      method: 'PUT',
      resource: 'team',
      action: 'update',
      description: 'Assign manager to team',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: assignManagerSchema,
      tags: ['teams', 'manager']
    });

    // Team hierarchy endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/hierarchy',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team hierarchy structure',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'hierarchy']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/hierarchy',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Create team hierarchy relationship',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: createTeamHierarchySchema,
      tags: ['teams', 'hierarchy']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/hierarchy',
      method: 'DELETE',
      resource: 'team',
      action: 'update',
      description: 'Remove team from hierarchy',
      permissions: { resource: 'team', action: 'update' },
      tags: ['teams', 'hierarchy']
    });

    // Team permissions endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/permissions',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team permissions',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'permissions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/permissions',
      method: 'POST',
      resource: 'team',
      action: 'manage',
      description: 'Grant permission to team',
      permissions: { resource: 'team', action: 'manage' },
      requestSchema: grantTeamPermissionSchema,
      tags: ['teams', 'permissions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/permissions/{permissionId}',
      method: 'DELETE',
      resource: 'team',
      action: 'manage',
      description: 'Revoke team permission',
      permissions: { resource: 'team', action: 'manage' },
      tags: ['teams', 'permissions']
    });

    // Team project assignment endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/projects',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team project assignments',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'projects']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/projects',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Assign team to project',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: assignTeamToProjectSchema,
      tags: ['teams', 'projects']
    });

    // Team analytics endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/analytics',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team analytics and performance metrics',
      permissions: { resource: 'team', action: 'read' },
      querySchema: teamAnalyticsQuerySchema,
      tags: ['teams', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/performance',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team performance metrics',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'performance']
    });

    // Search and filtering endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/search',
      method: 'POST',
      resource: 'team',
      action: 'read',
      description: 'Advanced team search with filters',
      permissions: { resource: 'team', action: 'read' },
      requestSchema: advancedTeamSearchSchema,
      tags: ['teams', 'search']
    });

    // Bulk operations endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/bulk',
      method: 'PUT',
      resource: 'team',
      action: 'update',
      description: 'Bulk update teams',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: bulkUpdateTeamsSchema,
      tags: ['teams', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/bulk',
      method: 'DELETE',
      resource: 'team',
      action: 'delete',
      description: 'Bulk delete teams',
      permissions: { resource: 'team', action: 'delete' },
      requestSchema: bulkDeleteTeamsSchema,
      tags: ['teams', 'bulk']
    });

    // Statistics endpoint
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/stats',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team statistics',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'statistics']
    });

    // Communication endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/channels',
      method: 'GET',
      resource: 'team',
      action: 'read',
      description: 'Get team communication channels',
      permissions: { resource: 'team', action: 'read' },
      tags: ['teams', 'communication']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/channels',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Create team communication channel',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: createTeamCommunicationChannelSchema,
      tags: ['teams', 'communication']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/workspaces',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Create team collaboration workspace',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: createTeamCollaborationWorkspaceSchema,
      tags: ['teams', 'collaboration']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/teams/{id}/meetings',
      method: 'POST',
      resource: 'team',
      action: 'update',
      description: 'Schedule team meeting',
      permissions: { resource: 'team', action: 'update' },
      requestSchema: scheduleTeamMeetingSchema,
      tags: ['teams', 'meetings']
    });
  }

  // ============================================================================
  // Enhanced CRUD Operations
  // ============================================================================

  /**
   * Enhanced list method with additional metadata and HATEOAS links
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(teamListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'team_name';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions = { page, limit, filters, sort, order };
      const result = await this.teamService.list(listOptions, req.context!);
      
      // Add HATEOAS links to each team
      const enhancedData = result.data.map(team => ({
        ...team,
        _links: this.teamService.generateTeamLinks(team.team_id, url.origin)
      }));

      return createPaginatedResponse(
        enhancedData,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'team'
        }
      );
    });
  }

  /**
   * Enhanced getById with extended options and HATEOAS links
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const url = new URL(req.url);
      
      // Parse query options for extended data
      const options: TeamServiceOptions = {
        includeMembers: url.searchParams.get('include_members') === 'true',
        includeManager: url.searchParams.get('include_manager') === 'true',
        includeProjects: url.searchParams.get('include_projects') === 'true',
        includeAnalytics: url.searchParams.get('include_analytics') === 'true',
        includePermissions: url.searchParams.get('include_permissions') === 'true'
      };

      const team = await this.teamService.getById(id, req.context!, options);
      
      if (!team) {
        throw new NotFoundError('Team not found');
      }

      // Add HATEOAS links
      const links = this.teamService.generateTeamLinks(id, url.origin);

      return createSuccessResponse({ ...team, _links: links });
    });
  }

  /**
   * Enhanced create with HATEOAS links
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createTeamSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTeamData) => {
      const team = await this.teamService.create(validatedData, req.context!);
      const url = new URL(req.url);
      
      // Add HATEOAS links
      const links = this.teamService.generateTeamLinks(team.team_id, url.origin);

      return createSuccessResponse({ ...team, _links: links }, 201);
    });
  }

  /**
   * Enhanced update with HATEOAS links
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateTeamSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateTeamData) => {
      const id = this.extractIdFromPath(req);
      const team = await this.teamService.update(id, validatedData, req.context!);
      const url = new URL(req.url);
      
      // Add HATEOAS links
      const links = this.teamService.generateTeamLinks(id, url.origin);

      return createSuccessResponse({ ...team, _links: links });
    });
  }

  // ============================================================================
  // Team Member Management
  // ============================================================================

  /**
   * GET /api/v1/teams/{id}/members - Get team members
   */
  getTeamMembers() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const teamId = this.extractIdFromPath(req);
      const team = await this.teamService.getById(teamId, req.context!);
      
      if (!team) {
        throw new NotFoundError('Team not found');
      }

      return createSuccessResponse({
        team_id: teamId,
        team_name: team.team_name,
        members: team.members || [],
        member_count: team.members?.length || 0
      });
    });
  }

  /**
   * POST /api/v1/teams/{id}/members - Add member to team
   */
  addTeamMember() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(addTeamMemberSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { user_id: string }) => {
      const teamId = this.extractIdFromPath(req);
      const team = await this.teamService.addMember(teamId, validatedData.user_id, req.context!);
      
      return createSuccessResponse(team);
    });
  }

  /**
   * DELETE /api/v1/teams/{id}/members/{userId} - Remove member from team
   */
  removeTeamMember() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const teamId = pathParts[4]; // /api/v1/teams/{id}/members/{userId}
      const userId = pathParts[6];

      if (!teamId || !userId) {
        throw new ValidationError('Team ID and User ID are required');
      }

      const team = await this.teamService.removeMember(teamId, userId, req.context!);
      
      return createSuccessResponse(team);
    });
  }

  /**
   * POST /api/v1/teams/{id}/members/bulk - Bulk add members to team
   */
  bulkAddMembers() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(bulkAddTeamMembersSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { user_ids: string[] }) => {
      const teamId = this.extractIdFromPath(req);
      const team = await this.teamService.addMembers(teamId, validatedData.user_ids, req.context!);
      
      return createSuccessResponse(team);
    });
  }

  /**
   * DELETE /api/v1/teams/{id}/members/bulk - Bulk remove members from team
   */
  bulkRemoveMembers() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(bulkRemoveTeamMembersSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { user_ids: string[] }) => {
      const teamId = this.extractIdFromPath(req);
      const team = await this.teamService.removeMembers(teamId, validatedData.user_ids, req.context!);
      
      return createSuccessResponse(team);
    });
  }

  /**
   * PUT /api/v1/teams/{id}/manager - Assign manager to team
   */
  assignManager() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(assignManagerSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { manager_id: string }) => {
      const teamId = this.extractIdFromPath(req);
      const team = await this.teamService.assignManager(teamId, validatedData.manager_id, req.context!);
      
      return createSuccessResponse(team);
    });
  }

  // ============================================================================
  // Team Hierarchy Management
  // ============================================================================

  /**
   * GET /api/v1/teams/hierarchy - Get team hierarchy
   */
  getTeamHierarchy() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const hierarchy = await this.teamService.getTeamHierarchy(req.context!);
      
      return createSuccessResponse({
        hierarchy,
        total_teams: hierarchy.reduce((acc, node) => acc + this.countTeamsInHierarchy(node), 0)
      });
    });
  }

  /**
   * POST /api/v1/teams/{id}/hierarchy - Create team hierarchy relationship
   */
  createTeamHierarchy() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(createTeamHierarchySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { parent_team_id: string; child_team_id: string }) => {
      await this.teamService.createTeamHierarchy(
        validatedData.parent_team_id, 
        validatedData.child_team_id, 
        req.context!
      );
      
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * DELETE /api/v1/teams/{id}/hierarchy - Remove team from hierarchy
   */
  removeTeamHierarchy() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const childTeamId = this.extractIdFromPath(req);
      await this.teamService.removeTeamHierarchy(childTeamId, req.context!);
      
      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // Team Permissions Management
  // ============================================================================

  /**
   * GET /api/v1/teams/{id}/permissions - Get team permissions
   */
  getTeamPermissions() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const teamId = this.extractIdFromPath(req);
      const permissions = await this.teamService.getTeamPermissions(teamId, req.context!);
      
      return createSuccessResponse({
        team_id: teamId,
        permissions,
        permission_count: permissions.length
      });
    });
  }

  /**
   * POST /api/v1/teams/{id}/permissions - Grant permission to team
   */
  grantTeamPermission() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'manage'),
      withValidation(grantTeamPermissionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { resource: string; action: string; expires_at?: string }) => {
      const teamId = this.extractIdFromPath(req);
      const expiresAt = validatedData.expires_at ? new Date(validatedData.expires_at) : undefined;
      
      await this.teamService.grantPermission(
        teamId,
        validatedData.resource,
        validatedData.action,
        req.context!,
        expiresAt
      );
      
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * DELETE /api/v1/teams/{id}/permissions/{permissionId} - Revoke team permission
   */
  revokeTeamPermission() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'manage')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const permissionId = pathParts[6]; // /api/v1/teams/{id}/permissions/{permissionId}

      if (!permissionId) {
        throw new ValidationError('Permission ID is required');
      }

      await this.teamService.revokePermission(permissionId, req.context!);
      
      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // Team Project Assignment
  // ============================================================================

  /**
   * GET /api/v1/teams/{id}/projects - Get team project assignments
   */
  getTeamProjects() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const teamId = this.extractIdFromPath(req);
      const projects = await this.teamService.getTeamProjects(teamId, req.context!);
      
      return createSuccessResponse({
        team_id: teamId,
        projects,
        project_count: projects.length
      });
    });
  }

  /**
   * POST /api/v1/teams/{id}/projects - Assign team to project
   */
  assignTeamToProject() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(assignTeamToProjectSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const teamId = this.extractIdFromPath(req);
      
      await this.teamService.assignToProject(
        teamId,
        validatedData.project_id,
        validatedData.role,
        req.context!,
        {
          startDate: validatedData.start_date ? new Date(validatedData.start_date) : undefined,
          endDate: validatedData.end_date ? new Date(validatedData.end_date) : undefined,
          allocationPercentage: validatedData.allocation_percentage,
          notes: validatedData.notes
        }
      );
      
      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // Team Analytics and Performance
  // ============================================================================

  /**
   * GET /api/v1/teams/{id}/analytics - Get team analytics
   */
  getTeamAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read'),
      withQueryValidation(teamAnalyticsQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const teamId = this.extractIdFromPath(req);
      
      const options = {
        startDate: validatedQuery.start_date ? new Date(validatedQuery.start_date) : undefined,
        endDate: validatedQuery.end_date ? new Date(validatedQuery.end_date) : undefined,
        includeMetrics: validatedQuery.include_metrics
      };

      const analytics = await this.teamService.getTeamAnalytics(teamId, req.context!, options);
      
      return createSuccessResponse(analytics);
    });
  }

  /**
   * GET /api/v1/teams/{id}/performance - Get team performance metrics
   */
  getTeamPerformance() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const teamId = this.extractIdFromPath(req);
      const performance = await this.teamService.getTeamPerformanceMetrics(teamId, req.context!);
      
      return createSuccessResponse(performance);
    });
  }

  // ============================================================================
  // Search and Filtering
  // ============================================================================

  /**
   * POST /api/v1/teams/search - Advanced team search
   */
  advancedSearch() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read'),
      withValidation(advancedTeamSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const searchOptions: TeamSearchOptions = {
        query: validatedData.query,
        skills: validatedData.filters?.member_skills,
        availability: validatedData.filters?.availability,
        location: validatedData.filters?.location,
        department: validatedData.filters?.department,
        performanceRating: validatedData.filters?.performance_rating
      };

      const paginationOptions = {
        page: validatedData.pagination?.page || 1,
        limit: Math.min(validatedData.pagination?.limit || 25, 100)
      };

      const result = await this.teamService.search(searchOptions, req.context!, paginationOptions);
      const url = new URL(req.url);
      
      // Add HATEOAS links to each team
      const enhancedData = result.data.map(team => ({
        ...team,
        _links: this.teamService.generateTeamLinks(team.team_id, url.origin)
      }));

      return createPaginatedResponse(
        enhancedData,
        result.total,
        paginationOptions.page,
        paginationOptions.limit,
        {
          search: searchOptions,
          resource: 'team'
        }
      );
    });
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * PUT /api/v1/teams/bulk - Bulk update teams
   */
  bulkUpdate() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(bulkUpdateTeamsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { teams: Array<{ team_id: string; data: UpdateTeamData }> }) => {
      const mappedTeams = validatedData.teams.map(team => ({
        id: team.team_id,
        data: team.data
      }));
      const results = await this.teamService.bulkUpdate(mappedTeams, req.context!);
      
      return createSuccessResponse({
        updated_teams: results,
        success_count: results.length,
        total_requested: validatedData.teams.length
      });
    });
  }

  /**
   * DELETE /api/v1/teams/bulk - Bulk delete teams
   */
  bulkDelete() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'delete'),
      withValidation(bulkDeleteTeamsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { team_ids: string[] }) => {
      await this.teamService.bulkDelete(validatedData.team_ids, req.context!);
      
      return createSuccessResponse({
        deleted_teams: validatedData.team_ids,
        success_count: validatedData.team_ids.length
      });
    });
  }

  // ============================================================================
  // Statistics and Reporting
  // ============================================================================

  /**
   * GET /api/v1/teams/stats - Get team statistics
   */
  getTeamStats() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.teamService.getTeamStats(req.context!);
      return createSuccessResponse(stats);
    });
  }

  // ============================================================================
  // Team Communication Features (Placeholder implementations)
  // ============================================================================

  /**
   * GET /api/v1/teams/{id}/channels - Get team communication channels
   */
  getTeamChannels() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const teamId = this.extractIdFromPath(req);
      
      // Placeholder implementation - would integrate with actual communication system
      return createSuccessResponse({
        team_id: teamId,
        channels: [],
        message: 'Communication channels feature coming soon'
      });
    });
  }

  /**
   * POST /api/v1/teams/{id}/channels - Create team communication channel
   */
  createTeamChannel() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(createTeamCommunicationChannelSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const teamId = this.extractIdFromPath(req);
      
      // Placeholder implementation
      return createSuccessResponse({
        team_id: teamId,
        channel: validatedData,
        message: 'Communication channel creation feature coming soon'
      }, 201);
    });
  }

  /**
   * POST /api/v1/teams/{id}/workspaces - Create team collaboration workspace
   */
  createTeamWorkspace() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(createTeamCollaborationWorkspaceSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const teamId = this.extractIdFromPath(req);
      
      // Placeholder implementation
      return createSuccessResponse({
        team_id: teamId,
        workspace: validatedData,
        message: 'Collaboration workspace creation feature coming soon'
      }, 201);
    });
  }

  /**
   * POST /api/v1/teams/{id}/meetings - Schedule team meeting
   */
  scheduleTeamMeeting() {
    const middleware = compose(
      withAuth,
      withPermission('team', 'update'),
      withValidation(scheduleTeamMeetingSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const teamId = this.extractIdFromPath(req);
      
      // Placeholder implementation
      return createSuccessResponse({
        team_id: teamId,
        meeting: validatedData,
        message: 'Meeting scheduling feature coming soon'
      }, 201);
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Count total teams in hierarchy structure
   */
  private countTeamsInHierarchy(node: any): number {
    let count = 1;
    if (node.subteams && node.subteams.length > 0) {
      count += node.subteams.reduce((acc: number, subteam: any) => 
        acc + this.countTeamsInHierarchy(subteam), 0);
    }
    return count;
  }
}
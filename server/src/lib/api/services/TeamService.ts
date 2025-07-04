/**
 * Team API Service
 * Comprehensive service layer for team-related operations
 */

import { Knex } from 'knex';
import { v4 as uuid4 } from 'uuid';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { ITeam, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { withTransaction } from '@shared/db';
import { 
  CreateTeamData,
  UpdateTeamData,
  TeamFilterData,
  TeamAnalyticsResponse,
  TeamPerformanceMetrics,
  TeamProjectAssignment,
  TeamTaskAssignment,
  TeamCommunicationChannel,
  TeamCollaborationWorkspace,
  TeamMeeting,
  TeamWithExtendedInfo,
  TeamStatsResponse,
  UserWithRoles,
  teamResponseSchema,
  validateTeamNameUniqueness,
  validateManagerNotMember,
  validateTeamSize,
  validateTeamAccess,
  validateTeamCapacity
} from '../schemas/teamSchemas';
import { ListOptions } from '../controllers/BaseController';
import { getMultipleUsersWithRoles, getUserById } from 'server/src/lib/actions/user-actions/userActions';
import TeamModel from 'server/src/lib/models/team';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { 
  generateResourceLinks, 
  generateComprehensiveLinks,
  generateCollectionLinks,
  addHateoasLinks 
} from '../utils/responseHelpers';
import logger from 'server/src/utils/logger';

export interface TeamServiceOptions {
  includeMembers?: boolean;
  includeManager?: boolean;
  includeProjects?: boolean;
  includeAnalytics?: boolean;
  includePermissions?: boolean;
}

export interface TeamSearchOptions {
  query?: string;
  skills?: string[];
  availability?: 'available' | 'busy' | 'overallocated';
  location?: string;
  department?: string;
  performanceRating?: 'low' | 'medium' | 'high';
}

export interface TeamHierarchyNode {
  team_id: string;
  team_name: string;
  manager_id: string | null;
  manager_name?: string;
  parent_team_id?: string | null;
  level: number;
  member_count: number;
  subteams?: TeamHierarchyNode[];
}

export interface TeamCapacityInfo {
  team_id: string;
  total_capacity: number;
  current_allocation: number;
  available_capacity: number;
  overallocation: number;
  member_utilization: Array<{
    user_id: string;
    user_name: string;
    capacity: number;
    allocation: number;
    utilization_percentage: number;
  }>;
}

export class TeamService extends BaseService<ITeam> {
  constructor() {
    super({
      tableName: 'teams',
      primaryKey: 'team_id',
      tenantColumn: 'tenant',
      searchableFields: ['team_name'],
      defaultSort: 'team_name',
      defaultOrder: 'asc'
    });
  }

  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  /**
   * List teams with enhanced filtering and search
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<ITeam>> {
      const { knex } = await this.getKnex();
      
      const {
        page = 1,
        limit = 25,
        filters = {} as TeamFilterData,
        sort,
        order
      } = options;
  
      // Build base query with manager and company joins
      let dataQuery = knex('teams as t')
        .leftJoin('users as manager', function() {
          this.on('t.manager_id', '=', 'manager.user_id')
              .andOn('t.tenant', '=', 'manager.tenant');
        })
        .where('t.tenant', context.tenant);
  
      let countQuery = knex('teams as t')
        .where('t.tenant', context.tenant);
  
      // Apply filters
      dataQuery = this.applyTeamFilters(dataQuery, filters, knex);
      countQuery = this.applyTeamFilters(countQuery, filters, knex);
  
      // Apply sorting
      const sortField = sort || this.defaultSort;
      const sortOrder = order || this.defaultOrder;
      
      if (sortField === 'manager_name') {
        dataQuery = dataQuery.orderByRaw(`COALESCE(manager.first_name || ' ' || manager.last_name, manager.username) ${sortOrder}`);
      } else if (sortField === 'member_count') {
        dataQuery = dataQuery.orderBy('member_count', sortOrder);
      } else {
        dataQuery = dataQuery.orderBy(`t.${sortField}`, sortOrder);
      }
  
      // Apply pagination
      const offset = (page - 1) * limit;
      dataQuery = dataQuery.limit(limit).offset(offset);
  
      // Select fields with member count
      dataQuery = dataQuery.select(
        't.*',
        knex.raw('COALESCE(manager.first_name || \' \' || manager.last_name, manager.username) as manager_name'),
        knex.raw(`(
          SELECT COUNT(*)
          FROM team_members tm
          JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
          WHERE tm.team_id = t.team_id
          AND tm.tenant = t.tenant
          AND u.is_inactive = false
        ) as member_count`)
      );
  
      // Execute queries
      const [teams, [{ count }]] = await Promise.all([
        dataQuery,
        countQuery.count('* as count')
      ]);
  
      // Enhance teams with members and HATEOAS links
      const enhancedTeams = await Promise.all(
        teams.map(async (team: any) => {
          const memberIds = await TeamModel.getMembers(knex, team.team_id);
          const members = memberIds.length > 0 ? await getMultipleUsersWithRoles(memberIds) : [];
          
          const teamData = {
            ...team,
            members,
            member_count: parseInt(team.member_count)
          } as ITeam;
  
          // Generate individual team HATEOAS links
          const teamLinks = generateComprehensiveLinks('teams', team.team_id, '/api/v1', {
            crudActions: ['read', 'update', 'delete'],
            relationships: {
              members: { resource: 'users', many: true },
              projects: { resource: 'projects', many: true }
            },
            customActions: {
              analytics: { method: 'GET', path: 'analytics' },
              permissions: { method: 'GET', path: 'permissions' }
            }
          });
  
          return addHateoasLinks(teamData, teamLinks);
        })
      );
  
      const total = parseInt(count as string);
      const totalPages = Math.ceil(total / limit);
  
      // Generate collection-level HATEOAS links
      const collectionLinks = generateCollectionLinks(
        'teams',
        '/api/v1',
        { page, limit, total, totalPages },
        filters
      );
  
      return {
        data: enhancedTeams,
        total,
        _links: collectionLinks
      };
    }


  /**
   * Get team by ID with enhanced data
   */
  async getById(id: string, context: ServiceContext, options: TeamServiceOptions = {}): Promise<ITeam | null> {
      const { knex } = await this.getKnex();
  
      const team = await knex('teams as t')
        .leftJoin('users as manager', function() {
          this.on('t.manager_id', '=', 'manager.user_id')
              .andOn('t.tenant', '=', 'manager.tenant');
        })
        .select(
          't.*',
          knex.raw('COALESCE(manager.first_name || \' \' || manager.last_name, manager.username) as manager_name'),
          'manager.email as manager_email'
        )
        .where({ 't.team_id': id, 't.tenant': context.tenant })
        .first();
  
      if (!team) {
        return null;
      }
  
      // Get team members
      const memberIds = await TeamModel.getMembers(knex, id);
      const members = memberIds.length > 0 ? await getMultipleUsersWithRoles(memberIds) : [];
  
      let enhancedTeam: any = {
        ...team,
        members
      };
  
      // Add manager details if requested
      if (options.includeManager && team.manager_id) {
        try {
          const manager = await getUserById(team.manager_id);
          enhancedTeam.manager = manager;
        } catch (error) {
          logger.warn(`Failed to fetch manager details for team ${id}:`, error);
        }
      }
  
      // Add projects if requested
      if (options.includeProjects) {
        enhancedTeam.projects = await this.getTeamProjects(id, context);
      }
  
      // Add analytics if requested
      if (options.includeAnalytics) {
        try {
          enhancedTeam.analytics = await this.getTeamAnalytics(id, context);
        } catch (error) {
          logger.warn(`Failed to fetch analytics for team ${id}:`, error);
        }
      }
  
      // Add permissions if requested
      if (options.includePermissions) {
        enhancedTeam.permissions = await this.getTeamPermissions(id, context);
      }
  
      // Generate HATEOAS links
      const links = generateComprehensiveLinks('teams', id, '/api/v1', {
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          members: { resource: 'users', many: true },
          projects: { resource: 'projects', many: true },
          manager: { resource: 'users', many: false }
        },
        customActions: {
          'add-member': { method: 'POST', path: 'members' },
          'remove-member': { method: 'DELETE', path: 'members' },
          'assign-manager': { method: 'PUT', path: 'manager' },
          'assign-project': { method: 'POST', path: 'projects' },
          analytics: { method: 'GET', path: 'analytics' },
          permissions: { method: 'GET', path: 'permissions' },
          hierarchy: { method: 'GET', path: 'hierarchy' },
          capacity: { method: 'GET', path: 'capacity' }
        }
      });
  
      return addHateoasLinks(enhancedTeam as ITeam, links);
    }


  /**
   * Create new team with validation
    // Override for BaseService compatibility  
    async create(data: Partial<ITeam>, context: ServiceContext): Promise<ITeam>;
    async create(data: CreateTeamData, context: ServiceContext): Promise<ITeam>;
    async create(data: CreateTeamData | Partial<ITeam>, context: ServiceContext): Promise<ITeam> {
      // Ensure we have required fields for CreateTeamData
      if (!data.team_name) {
        throw new Error('Team name is required');
      }
      return this.createTeam(data as CreateTeamData, context);
    }
  
    private async createTeam(data: CreateTeamData, context: ServiceContext): Promise<ITeam> {
   */
    // Override for BaseService compatibility  
    async create(data: Partial<ITeam>, context: ServiceContext): Promise<ITeam>;
    async create(data: CreateTeamData, context: ServiceContext): Promise<ITeam>;
    async create(data: CreateTeamData | Partial<ITeam>, context: ServiceContext): Promise<ITeam> {
      // Ensure we have required fields for CreateTeamData
      if (!data.team_name) {
        throw new Error('Team name is required');
      }
      return this.createTeam(data as CreateTeamData, context);
    }
  
    private async createTeam(data: CreateTeamData, context: ServiceContext): Promise<ITeam> {
      const { knex } = await this.getKnex();
  
      return withTransaction(knex, async (trx) => {
        // Validate team name uniqueness
        const existingTeams = await trx('teams')
          .where('tenant', context.tenant)
          .pluck('team_name');
        
        if (!validateTeamNameUniqueness(data.team_name, existingTeams)) {
          throw new Error('Team name already exists');
        }
  
        // Validate manager if provided
        if (data.manager_id) {
          const manager = await trx('users')
            .where({ user_id: data.manager_id, tenant: context.tenant, is_inactive: false })
            .first();
          
          if (!manager) {
            throw new Error('Manager not found or inactive');
          }
        }
  
        // Validate team size if members provided
        if (data.members && !validateTeamSize(data.members.length)) {
          throw new Error('Team size exceeds maximum allowed members');
        }
  
        // Create team
        const teamData = {
          team_id: uuid4(),
          team_name: data.team_name,
          manager_id: data.manager_id || null,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [team] = await trx('teams').insert(teamData).returning('*');
  
        // Add members if provided
        if (data.members && data.members.length > 0) {
          const memberIds = data.members.map(m => m.user_id);
          
          // Validate manager is not a member
          if (data.manager_id && !validateManagerNotMember(data.manager_id, memberIds)) {
            throw new Error('Manager cannot be a team member');
          }
  
          // Add members
          const memberInserts = memberIds.map(userId => ({
            team_id: team.team_id,
            user_id: userId,
            tenant: context.tenant,
            created_at: new Date()
          }));
  
          await trx('team_members').insert(memberInserts);
        }
  
        // Publish team created event
        await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
  
        // Return full team with members
        return this.getById(team.team_id, context) as Promise<ITeam>;
      });
    }


  /**
   * Update team with validation
   */
  async update(id: string, data: UpdateTeamData, context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check team exists
      const existingTeam = await trx('teams')
        .where({ team_id: id, tenant: context.tenant })
        .first();
      
      if (!existingTeam) {
        throw new Error('Team not found or permission denied');
      }

      // Validate team name uniqueness if changing
      if (data.team_name && data.team_name !== existingTeam.team_name) {
        const existingTeams = await trx('teams')
          .where('tenant', context.tenant)
          .whereNot('team_id', id)
          .pluck('team_name');
        
        if (!validateTeamNameUniqueness(data.team_name, existingTeams)) {
          throw new Error('Team name already exists');
        }
      }

      // Validate manager if changing
      if (data.manager_id !== undefined) {
        if (data.manager_id) {
          const manager = await trx('users')
            .where({ user_id: data.manager_id, tenant: context.tenant, is_inactive: false })
            .first();
          
          if (!manager) {
            throw new Error('Manager not found or inactive');
          }

          // Validate manager is not a member
          const memberIds = await TeamModel.getMembers(trx, id);
          if (!validateManagerNotMember(data.manager_id, memberIds)) {
            throw new Error('Manager cannot be a team member');
          }
        }
      }

      // Remove undefined values from data object
      const cleanedData = { ...data };
      Object.keys(cleanedData).forEach(key => {
        if ((cleanedData as any)[key] === undefined) {
          delete (cleanedData as any)[key];
        }
      });
      
      const updateData = {
        ...cleanedData,
        updated_at: new Date()
      };

      await trx('teams')
        .where({ team_id: id, tenant: context.tenant })
        .update(updateData);

      // Publish team updated event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      // Return updated team
      return this.getById(id, context) as Promise<ITeam>;
    });
  }

  /**
   * Delete team with cleanup
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check team exists
      const team = await trx('teams')
        .where({ team_id: id, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Check for dependencies
      const [projectCount, taskCount] = await Promise.all([
        trx('project_team_assignments')
          .where({ team_id: id, tenant: context.tenant })
          .count('* as count')
          .first(),
        trx('task_assignments')
          .where({ team_id: id, tenant: context.tenant })
          .count('* as count')
          .first()
      ]);

      if (parseInt(projectCount?.count as string || '0') > 0 || parseInt(taskCount?.count as string || '0') > 0) {
        throw new Error('Cannot delete team with active project or task assignments');
      }

      // Delete team members first
      await trx('team_members')
        .where({ team_id: id, tenant: context.tenant })
        .del();

      // Delete team permissions
      await trx('team_permissions')
        .where({ team_id: id, tenant: context.tenant })
        .del();

      // Delete team communication channels
      await trx('team_communication_channels')
        .where({ team_id: id, tenant: context.tenant })
        .del();

      // Delete team collaboration workspaces
      await trx('team_collaboration_workspaces')
        .where({ team_id: id, tenant: context.tenant })
        .del();

      // Delete the team
      await trx('teams')
        .where({ team_id: id, tenant: context.tenant })
        .del();

      // Publish team deleted event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
    });
  }

  // ============================================================================
  // Team Member Management
  // ============================================================================

  /**
   * Add member to team
   */
  async addMember(teamId: string, userId: string, context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Validate user exists and is active
      const user = await trx('users')
        .where({ user_id: userId, tenant: context.tenant, is_inactive: false })
        .first();
      
      if (!user) {
        throw new Error('User not found or inactive');
      }

      // Check if user is already a member
      const existingMember = await trx('team_members')
        .where({ team_id: teamId, user_id: userId, tenant: context.tenant })
        .first();
      
      if (existingMember) {
        throw new Error('User is already a team member');
      }

      // Check if user is the team manager
      if (team.manager_id === userId) {
        throw new Error('Manager cannot be added as a team member');
      }

      // Check team size limit
      const currentMemberCount = await trx('team_members')
        .where({ team_id: teamId, tenant: context.tenant })
        .count('* as count')
        .first();
      
      if (!validateTeamSize(parseInt(currentMemberCount?.count as string || '0') + 1)) {
        throw new Error('Team size would exceed maximum allowed members');
      }

      // Add member
      await trx('team_members').insert({
        team_id: teamId,
        user_id: userId,
        tenant: context.tenant,
        joined_at: new Date()
      });

      // Publish member added event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      return this.getById(teamId, context) as Promise<ITeam>;
    });
  }

  /**
   * Remove member from team
   */
  async removeMember(teamId: string, userId: string, context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Check if user is a member
      const existingMember = await trx('team_members')
        .where({ team_id: teamId, user_id: userId, tenant: context.tenant })
        .first();
      
      if (!existingMember) {
        throw new Error('User is not a team member');
      }

      // Remove member
      await trx('team_members')
        .where({ team_id: teamId, user_id: userId, tenant: context.tenant })
        .del();

      // Remove any specific task assignments
      await trx('task_assignments')
        .where({ team_id: teamId, user_id: userId, tenant: context.tenant })
        .del();

      // Publish member removed event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      return this.getById(teamId, context) as Promise<ITeam>;
    });
  }

  /**
   * Bulk add members to team
   */
  async addMembers(teamId: string, userIds: string[], context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Validate all users exist and are active
      const users = await trx('users')
        .whereIn('user_id', userIds)
        .where({ tenant: context.tenant, is_inactive: false });
      
      if (users.length !== userIds.length) {
        throw new Error('Some users not found or inactive');
      }

      // Check for manager in member list
      if (team.manager_id && userIds.includes(team.manager_id)) {
        throw new Error('Manager cannot be added as a team member');
      }

      // Check for existing members
      const existingMembers = await trx('team_members')
        .whereIn('user_id', userIds)
        .where({ team_id: teamId, tenant: context.tenant })
        .pluck('user_id');
      
      if (existingMembers.length > 0) {
        throw new Error('Some users are already team members');
      }

      // Check team size limit
      const currentMemberCount = await trx('team_members')
        .where({ team_id: teamId, tenant: context.tenant })
        .count('* as count')
        .first();
      
      const newTotalSize = parseInt(currentMemberCount?.count as string || '0') + userIds.length;
      if (!validateTeamSize(newTotalSize)) {
        throw new Error('Team size would exceed maximum allowed members');
      }

      // Add members
      const memberInserts = userIds.map(userId => ({
        team_id: teamId,
        user_id: userId,
        tenant: context.tenant,
        joined_at: new Date()
      }));

      await trx('team_members').insert(memberInserts);

      // Publish bulk members added event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      return this.getById(teamId, context) as Promise<ITeam>;
    });
  }

  /**
   * Bulk remove members from team
   */
  async removeMembers(teamId: string, userIds: string[], context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Remove members
      await trx('team_members')
        .whereIn('user_id', userIds)
        .where({ team_id: teamId, tenant: context.tenant })
        .del();

      // Remove any specific task assignments
      await trx('task_assignments')
        .whereIn('user_id', userIds)
        .where({ team_id: teamId, tenant: context.tenant })
        .del();

      // Publish bulk members removed event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      return this.getById(teamId, context) as Promise<ITeam>;
    });
  }

  /**
   * Assign manager to team
   */
  async assignManager(teamId: string, managerId: string, context: ServiceContext): Promise<ITeam> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Validate manager exists and is active
      const manager = await trx('users')
        .where({ user_id: managerId, tenant: context.tenant, is_inactive: false })
        .first();
      
      if (!manager) {
        throw new Error('Manager not found or inactive');
      }

      // Check if manager is currently a team member - remove if so
      const isCurrentMember = await trx('team_members')
        .where({ team_id: teamId, user_id: managerId, tenant: context.tenant })
        .first();
      
      if (isCurrentMember) {
        await trx('team_members')
          .where({ team_id: teamId, user_id: managerId, tenant: context.tenant })
          .del();
      }

      // Update team manager
      await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .update({ 
          manager_id: managerId,
          updated_at: new Date()
        });

      // Publish manager assigned event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });

      return this.getById(teamId, context) as Promise<ITeam>;
    });
  }

  // ============================================================================
  // Team Hierarchy and Reporting
  // ============================================================================

  /**
   * Get team hierarchy
   */
  async getTeamHierarchy(context: ServiceContext): Promise<TeamHierarchyNode[]> {
    const { knex } = await this.getKnex();

    // Get all teams with their basic info
    const teams = await knex('teams as t')
      .leftJoin('users as m', function() {
        this.on('t.manager_id', '=', 'm.user_id')
            .andOn('t.tenant', '=', 'm.tenant');
      })
      .leftJoin('team_hierarchy as th', function() {
        this.on('t.team_id', '=', 'th.child_team_id')
            .andOn('t.tenant', '=', 'th.tenant');
      })
      .where('t.tenant', context.tenant)
      .select(
        't.team_id',
        't.team_name',
        't.manager_id',
        knex.raw('COALESCE(m.first_name || \' \' || m.last_name, m.username) as manager_name'),
        'th.parent_team_id',
        knex.raw(`(
          SELECT COUNT(*)
          FROM team_members tm
          JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
          WHERE tm.team_id = t.team_id
          AND tm.tenant = t.tenant
          AND u.is_inactive = false
        ) as member_count`)
      );

    // Build hierarchy structure
    const teamMap = new Map<string, TeamHierarchyNode>();
    const rootTeams: TeamHierarchyNode[] = [];

    // First pass: create all nodes
    teams.forEach(team => {
      const node: TeamHierarchyNode = {
        team_id: team.team_id,
        team_name: team.team_name,
        manager_id: team.manager_id,
        manager_name: team.manager_name,
        parent_team_id: team.parent_team_id,
        level: 0,
        member_count: parseInt(team.member_count),
        subteams: []
      };
      teamMap.set(team.team_id, node);
    });

    // Second pass: build hierarchy and calculate levels
    teamMap.forEach(node => {
      if (node.parent_team_id) {
        const parent = teamMap.get(node.parent_team_id);
        if (parent) {
          parent.subteams!.push(node);
          node.level = parent.level + 1;
        } else {
          // Parent not found, treat as root
          rootTeams.push(node);
        }
      } else {
        rootTeams.push(node);
      }
    });

    return rootTeams;
  }

  /**
   * Create team hierarchy relationship
   */
  async createTeamHierarchy(parentTeamId: string, childTeamId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate both teams exist
      const [parentTeam, childTeam] = await Promise.all([
        trx('teams').where({ team_id: parentTeamId, tenant: context.tenant }).first(),
        trx('teams').where({ team_id: childTeamId, tenant: context.tenant }).first()
      ]);

      if (!parentTeam || !childTeam) {
        throw new Error('One or both teams not found');
      }

      // Check for circular dependencies
      if (await this.wouldCreateCircularDependency(parentTeamId, childTeamId, context, trx)) {
        throw new Error('Cannot create circular team hierarchy');
      }

      // Create or update hierarchy relationship
      await trx('team_hierarchy')
        .insert({
          parent_team_id: parentTeamId,
          child_team_id: childTeamId,
          tenant: context.tenant,
          created_at: new Date()
        })
        .onConflict(['child_team_id', 'tenant'])
        .merge({
          parent_team_id: parentTeamId,
          updated_at: new Date()
        });

      // Publish hierarchy created event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
    });
  }

  /**
   * Remove team hierarchy relationship
   */
  async removeTeamHierarchy(childTeamId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    await knex('team_hierarchy')
      .where({ child_team_id: childTeamId, tenant: context.tenant })
      .del();

    // Publish hierarchy removed event
    await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
  }

  // ============================================================================
  // Team Permissions and Access Control
  // ============================================================================

  /**
   * Grant permission to team
   */
  async grantPermission(
    teamId: string, 
    resource: string, 
    action: string, 
    context: ServiceContext,
    expiresAt?: Date
  ): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team exists
      const team = await trx('teams')
        .where({ team_id: teamId, tenant: context.tenant })
        .first();
      
      if (!team) {
        throw new Error('Team not found or permission denied');
      }

      // Grant permission
      await trx('team_permissions').insert({
        permission_id: uuid4(),
        team_id: teamId,
        resource,
        action,
        granted_by: context.userId,
        granted_at: new Date(),
        expires_at: expiresAt,
        is_active: true,
        tenant: context.tenant
      });

      // Publish permission granted event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
    });
  }

  /**
   * Revoke permission from team
   */
  async revokePermission(permissionId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    const permission = await knex('team_permissions')
      .where({ permission_id: permissionId, tenant: context.tenant })
      .first();

    if (!permission) {
      throw new Error('Permission not found');
    }

    await knex('team_permissions')
      .where({ permission_id: permissionId, tenant: context.tenant })
      .update({ 
        is_active: false,
        revoked_at: new Date(),
        revoked_by: context.userId
      });

    // Publish permission revoked event
    await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
  }

  /**
   * Get team permissions
   */
  async getTeamPermissions(teamId: string, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();

    const permissions = await knex('team_permissions')
      .where({
        team_id: teamId,
        tenant: context.tenant,
        is_active: true
      })
      .where(function() {
        this.whereNull('expires_at').orWhere('expires_at', '>', new Date());
      })
      .select('*');

    return permissions;
  }

  // ============================================================================
  // Team Project and Task Assignments
  // ============================================================================

  /**
   * Assign team to project
   */
  async assignToProject(
    teamId: string,
    projectId: string,
    role: 'primary' | 'secondary' | 'support' | 'consultant',
    context: ServiceContext,
    options: {
      startDate?: Date;
      endDate?: Date;
      allocationPercentage?: number;
      notes?: string;
    } = {}
  ): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate team and project exist
      const [team, project] = await Promise.all([
        trx('teams').where({ team_id: teamId, tenant: context.tenant }).first(),
        trx('projects').where({ project_id: projectId, tenant: context.tenant }).first()
      ]);

      if (!team || !project) {
        throw new Error('Team or project not found');
      }

      // Check capacity if allocation specified
      if (options.allocationPercentage) {
        const capacity = await this.getTeamCapacity(teamId, context);
        if (!validateTeamCapacity(capacity.current_allocation, options.allocationPercentage)) {
          throw new Error('Team allocation would exceed capacity');
        }
      }

      // Create assignment
      await trx('project_team_assignments').insert({
        assignment_id: uuid4(),
        team_id: teamId,
        project_id: projectId,
        role,
        assigned_by: context.userId,
        assigned_at: new Date(),
        start_date: options.startDate,
        end_date: options.endDate,
        allocation_percentage: options.allocationPercentage || 100,
        is_active: true,
        notes: options.notes,
        tenant: context.tenant
      });

      // Publish assignment event
      await publishEvent({
        eventType: 'PLACEHOLDER',
        payload: {}
      });
    });
  }

  /**
   * Get team projects
   */
  async getTeamProjects(teamId: string, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();

    const projects = await knex('project_team_assignments as pta')
      .join('projects as p', function() {
        this.on('pta.project_id', '=', 'p.project_id')
            .andOn('pta.tenant', '=', 'p.tenant');
      })
      .where({
        'pta.team_id': teamId,
        'pta.tenant': context.tenant,
        'pta.is_active': true
      })
      .select(
        'p.*',
        'pta.role',
        'pta.assigned_at',
        'pta.start_date',
        'pta.end_date',
        'pta.allocation_percentage',
        'pta.notes'
      );

    return projects;
  }

  // ============================================================================
  // Team Analytics and Performance
  // ============================================================================

  /**
   * Get team analytics
   */
  async getTeamAnalytics(
    teamId: string, 
    context: ServiceContext,
    options: {
      startDate?: Date;
      endDate?: Date;
      includeMetrics?: string[];
    } = {}
  ): Promise<TeamAnalyticsResponse> {
    const { knex } = await this.getKnex();

    const startDate = options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const endDate = options.endDate || new Date();

    // Get team basic info
    const team = await knex('teams')
      .where({ team_id: teamId, tenant: context.tenant })
      .first();

    if (!team) {
      throw new Error('Team not found');
    }

    // Get member count
    const memberCount = await knex('team_members as tm')
      .join('users as u', function() {
        this.on('tm.user_id', '=', 'u.user_id')
            .andOn('tm.tenant', '=', 'u.tenant');
      })
      .where({
        'tm.team_id': teamId,
        'tm.tenant': context.tenant,
        'u.is_inactive': false
      })
      .count('* as count')
      .first();

    // Get project statistics
    const [activeProjects, completedProjects] = await Promise.all([
      knex('project_team_assignments as pta')
        .join('projects as p', function() {
          this.on('pta.project_id', '=', 'p.project_id')
              .andOn('pta.tenant', '=', 'p.tenant');
        })
        .where({
          'pta.team_id': teamId,
          'pta.tenant': context.tenant,
          'pta.is_active': true,
          'p.status': 'active'
        })
        .count('* as count')
        .first(),
      
      knex('project_team_assignments as pta')
        .join('projects as p', function() {
          this.on('pta.project_id', '=', 'p.project_id')
              .andOn('pta.tenant', '=', 'p.tenant');
        })
        .where({
          'pta.team_id': teamId,
          'pta.tenant': context.tenant
        })
        .whereIn('p.status', ['completed', 'closed'])
        .count('* as count')
        .first()
    ]);

    // Get time tracking statistics
    const timeStats = await knex('time_entries as te')
      .join('team_members as tm', function() {
        this.on('te.user_id', '=', 'tm.user_id')
            .andOn('te.tenant', '=', 'tm.tenant');
      })
      .where({
        'tm.team_id': teamId,
        'tm.tenant': context.tenant
      })
      .whereBetween('te.start_time', [startDate, endDate])
      .select(
        knex.raw('SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600) as total_hours'),
        knex.raw('AVG(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600) as average_hours')
      )
      .first();

    // Get member utilization
    const memberUtilization = await knex('team_members as tm')
      .join('users as u', function() {
        this.on('tm.user_id', '=', 'u.user_id')
            .andOn('tm.tenant', '=', 'u.tenant');
      })
      .leftJoin('time_entries as te', function() {
        this.on('tm.user_id', '=', 'te.user_id')
            .andOn('tm.tenant', '=', 'te.tenant')
            .andOnBetween('te.start_time', [startDate, endDate]);
      })
      .where({
        'tm.team_id': teamId,
        'tm.tenant': context.tenant,
        'u.is_inactive': false
      })
      .groupBy('tm.user_id', 'u.first_name', 'u.last_name', 'u.username')
      .select(
        'tm.user_id',
        knex.raw('COALESCE(u.first_name || \' \' || u.last_name, u.username) as user_name'),
        knex.raw('COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600), 0) as hours_logged')
      );

    // Calculate utilization percentages (assuming 40 hours per week)
    const workingHours = 40 * ((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const enhancedMemberUtilization = memberUtilization.map(member => ({
      ...member,
      hours_logged: parseFloat(member.hours_logged) || 0,
      utilization_percentage: Math.min(100, ((parseFloat(member.hours_logged) || 0) / workingHours) * 100)
    }));

    const totalHours = parseFloat(timeStats?.total_hours) || 0;
    const avgHoursPerMember = totalHours / parseInt(memberCount?.count as string || '0');

    return {
      team_id: teamId,
      team_name: team.team_name,
      period: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      },
      member_count: parseInt(memberCount?.count as string || '0'),
      active_projects: parseInt(activeProjects?.count as string || '0'),
      completed_projects: parseInt(completedProjects?.count as string || '0'),
      total_hours_logged: totalHours,
      average_hours_per_member: avgHoursPerMember,
      productivity_score: this.calculateProductivityScore(totalHours, parseInt(memberCount?.count as string || '0')),
      project_completion_rate: this.calculateCompletionRate(
        parseInt(completedProjects?.count as string || '0'),
        parseInt(activeProjects?.count as string || '0') + parseInt(completedProjects?.count as string || '0')
      ),
      member_utilization: enhancedMemberUtilization,
      project_distribution: [] // Would need additional logic to calculate
    };
  }

  /**
   * Get team performance metrics
   */
  async getTeamPerformanceMetrics(teamId: string, context: ServiceContext): Promise<TeamPerformanceMetrics> {
    const { knex } = await this.getKnex();

    // This would typically involve complex calculations based on:
    // - Sprint velocity (if using agile)
    // - Task completion rates
    // - Quality metrics (bugs, rework)
    // - Client satisfaction scores
    // For now, returning mock structure

    return {
      team_id: teamId,
      metrics: {
        velocity: 0,
        burndown_rate: 0,
        cycle_time: 0,
        throughput: 0,
        quality_score: 0,
        client_satisfaction: 0,
        on_time_delivery_rate: 0
      },
      trends: {
        velocity_trend: 'stable',
        quality_trend: 'stable',
        productivity_trend: 'stable'
      },
      benchmarks: {
        industry_velocity: 0,
        company_velocity: 0,
        target_quality_score: 85
      }
    };
  }

  // ============================================================================
  // Search and Filtering
  // ============================================================================

  /**
   * Advanced team search
   */
  async search(
    searchOptions: TeamSearchOptions,
    context: ServiceContext,
    paginationOptions: { page?: number; limit?: number } = {}
  ): Promise<ListResult<ITeam>> {
    const { knex } = await this.getKnex();
    const { page = 1, limit = 25 } = paginationOptions;

    let query = knex('teams as t')
      .leftJoin('users as manager', function() {
        this.on('t.manager_id', '=', 'manager.user_id')
            .andOn('t.tenant', '=', 'manager.tenant');
      })
      .where('t.tenant', context.tenant);

    // Apply search filters
    if (searchOptions.query) {
      query = query.where(function() {
        this.whereILike('t.team_name', `%${searchOptions.query}%`)
            .orWhereRaw(`COALESCE(manager.first_name || ' ' || manager.last_name, manager.username) ILIKE ?`, [`%${searchOptions.query}%`]);
      });
    }

    if (searchOptions.skills && searchOptions.skills.length > 0) {
      // This would require a team_skills table or member skills aggregation
      // For now, just acknowledge the filter
    }

    if (searchOptions.location) {
      // This would require team location data
    }

    if (searchOptions.department) {
      // This would require team department data
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    const dataQuery = query.clone().limit(limit).offset(offset);
    const countQuery = query.clone();

    // Execute queries
    const [teams, [{ count }]] = await Promise.all([
      dataQuery.select(
        't.*',
        knex.raw('COALESCE(manager.first_name || \' \' || manager.last_name, manager.username) as manager_name')
      ),
      countQuery.count('* as count')
    ]);

    // Enhance with members
    const enhancedTeams = await Promise.all(
      teams.map(async (team: any) => {
        const memberIds = await TeamModel.getMembers(knex, team.team_id);
        const members = memberIds.length > 0 ? await getMultipleUsersWithRoles(memberIds) : [];
        
        return { ...team, members } as ITeam;
      })
    );

    return {
      data: enhancedTeams,
      total: parseInt(count as string)
    };
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Bulk update teams
   */
  async bulkUpdate(
      updates: Array<{ id: string; data: Partial<ITeam> }>,
      context: ServiceContext
    ): Promise<ITeam[]> {
      const { knex } = await this.getKnex();
  
      return withTransaction(knex, async (trx) => {
        const results: ITeam[] = [];
  
        for (const update of updates) {
          try {
            const result = await this.update(update.id, update.data, context);
            results.push(result);
          } catch (error) {
            logger.warn(`Failed to update team ${update.id}:`, error);
            // Continue with other updates
          }
        }
  
        return results;
      });
    }


  /**
   * Bulk delete teams
   */
  async bulkDelete(teamIds: string[], context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      for (const teamId of teamIds) {
        try {
          await this.delete(teamId, context);
        } catch (error) {
          logger.warn(`Failed to delete team ${teamId}:`, error);
          // Continue with other deletions
        }
      }
    });
  }

  // ============================================================================
  // Statistics and Reporting
  // ============================================================================

  /**
   * Get team statistics
   */
  async getTeamStats(context: ServiceContext): Promise<TeamStatsResponse> {
    const { knex } = await this.getKnex();

    const [
      totalStats,
      departmentStats,
      locationStats,
      performanceStats
    ] = await Promise.all([
      // Total and active team counts
      knex('teams')
        .where('tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_teams'),
          knex.raw('COUNT(CASE WHEN manager_id IS NOT NULL THEN 1 END) as teams_with_managers'),
          knex.raw(`AVG((
            SELECT COUNT(*)
            FROM team_members tm
            JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
            WHERE tm.team_id = teams.team_id
            AND tm.tenant = teams.tenant
            AND u.is_inactive = false
          )) as average_team_size`),
          knex.raw(`SUM((
            SELECT COUNT(*)
            FROM team_members tm
            JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
            WHERE tm.team_id = teams.team_id
            AND tm.tenant = teams.tenant
            AND u.is_inactive = false
          )) as total_members`)
        )
        .first(),

      // Teams by department (mock data - would need department field)
      Promise.resolve({}),

      // Teams by location (mock data - would need location field)
      Promise.resolve({}),

      // Performance distribution (mock data - would need performance metrics)
      Promise.resolve({
        high_performing: 0,
        average_performing: 0,
        needs_improvement: 0
      })
    ]);

    return {
      total_teams: parseInt(totalStats.total_teams),
      active_teams: parseInt(totalStats.total_teams), // All teams are considered active
      teams_with_managers: parseInt(totalStats.teams_with_managers),
      average_team_size: parseFloat(totalStats.average_team_size) || 0,
      total_members: parseInt(totalStats.total_members) || 0,
      teams_by_department: departmentStats,
      teams_by_location: locationStats,
      performance_distribution: performanceStats
    };
  }

  // ============================================================================
  // HATEOAS Link Generation
  // ============================================================================

  /**
   * Generate HATEOAS links for team resource
   */
  generateTeamLinks(teamId: string, baseUrl: string): Record<string, string> {
    return {
      self: `${baseUrl}/teams/${teamId}`,
      members: `${baseUrl}/teams/${teamId}/members`,
      projects: `${baseUrl}/teams/${teamId}/projects`,
      analytics: `${baseUrl}/teams/${teamId}/analytics`,
      permissions: `${baseUrl}/teams/${teamId}/permissions`,
      hierarchy: `${baseUrl}/teams/${teamId}/hierarchy`,
      edit: `${baseUrl}/teams/${teamId}`,
      delete: `${baseUrl}/teams/${teamId}`,
      collection: `${baseUrl}/teams`
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Apply team-specific filters
   */
  private applyTeamFilters(query: Knex.QueryBuilder, filters: TeamFilterData, knex: Knex): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'team_name':
          query.whereILike('t.team_name', `%${value}%`);
          break;
        case 'manager_id':
          query.where('t.manager_id', value);
          break;
        case 'has_manager':
          if (value) {
            query.whereNotNull('t.manager_id');
          } else {
            query.whereNull('t.manager_id');
          }
          break;
        case 'member_count_min':
          query.whereRaw(`(
            SELECT COUNT(*)
            FROM team_members tm
            JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
            WHERE tm.team_id = t.team_id
            AND tm.tenant = t.tenant
            AND u.is_inactive = false
          ) >= ?`, [value]);
          break;
        case 'member_count_max':
          query.whereRaw(`(
            SELECT COUNT(*)
            FROM team_members tm
            JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant
            WHERE tm.team_id = t.team_id
            AND tm.tenant = t.tenant
            AND u.is_inactive = false
          ) <= ?`, [value]);
          break;
        case 'project_id':
          query.whereExists(function() {
            this.select('*')
                .from('project_team_assignments as pta')
                .whereRaw('pta.team_id = t.team_id')
                .andWhere('pta.project_id', value)
                .andWhere('pta.tenant', '=', knex.ref('t.tenant'))
                .andWhere('pta.is_active', true);
          });
          break;
        case 'search':
          query.where(function() {
            this.whereILike('t.team_name', `%${value}%`)
                .orWhereRaw(`COALESCE(manager.first_name || ' ' || manager.last_name, manager.username) ILIKE ?`, [`%${value}%`]);
          });
          break;
        case 'created_from':
          query.where('t.created_at', '>=', value);
          break;
        case 'created_to':
          query.where('t.created_at', '<=', value);
          break;
        case 'updated_from':
          query.where('t.updated_at', '>=', value);
          break;
        case 'updated_to':
          query.where('t.updated_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Check if creating hierarchy would cause circular dependency
   */
  private async wouldCreateCircularDependency(
    parentTeamId: string,
    childTeamId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<boolean> {
    // Check if parent is a descendant of child
    const descendants = await this.getTeamDescendants(childTeamId, context, trx);
    return descendants.includes(parentTeamId);
  }

  /**
   * Get all descendants of a team
   */
  private async getTeamDescendants(
    teamId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<string[]> {
    const directChildren = await trx('team_hierarchy')
      .where({ parent_team_id: teamId, tenant: context.tenant })
      .pluck('child_team_id');

    const allDescendants = [...directChildren];

    for (const childId of directChildren) {
      const childDescendants = await this.getTeamDescendants(childId, context, trx);
      allDescendants.push(...childDescendants);
    }

    return allDescendants;
  }

  /**
   * Get team capacity information
   */
  private async getTeamCapacity(teamId: string, context: ServiceContext): Promise<TeamCapacityInfo> {
    const { knex } = await this.getKnex();

    // Get current allocations
    const allocations = await knex('project_team_assignments')
      .where({
        team_id: teamId,
        tenant: context.tenant,
        is_active: true
      })
      .sum('allocation_percentage as total_allocation')
      .first();

    const currentAllocation = parseInt(allocations?.total_allocation as string || '0') || 0;

    return {
      team_id: teamId,
      total_capacity: 100, // Assuming 100% capacity
      current_allocation: currentAllocation,
      available_capacity: Math.max(0, 100 - currentAllocation),
      overallocation: Math.max(0, currentAllocation - 100),
      member_utilization: [] // Would need additional logic
    };
  }

  /**
   * Calculate productivity score
   */
  private calculateProductivityScore(totalHours: number, memberCount: number): number {
    if (memberCount === 0) return 0;
    
    const avgHoursPerMember = totalHours / memberCount;
    const expectedHours = 40; // Hours per week
    
    return Math.min(100, (avgHoursPerMember / expectedHours) * 100);
  }

  /**
   * Calculate completion rate
   */
  private calculateCompletionRate(completedProjects: number, totalProjects: number): number {
    if (totalProjects === 0) return 0;
    return (completedProjects / totalProjects) * 100;
  }
}
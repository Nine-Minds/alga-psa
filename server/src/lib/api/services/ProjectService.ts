/**
 * Project API Service
 * Handles all project-related database operations for the REST API
 */

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { BaseService, ServiceContext, ListOptions, ListResult } from '@alga-psa/db';
import { 
  IProject, 
  IProjectPhase, 
  IProjectTask, 
  ITaskChecklistItem,
  IProjectTicketLink,
  ProjectStatus
} from 'server/src/interfaces/project.interfaces';
import { 
  CreateProjectData,
  UpdateProjectData,
  ProjectFilterData,
  CreateProjectPhaseData,
  UpdateProjectPhaseData,
  CreateProjectTaskData,
  UpdateProjectTaskData,
  CreateTaskChecklistItemData,
  CreateProjectTicketLinkData,
  ProjectSearchData,
  ProjectExportQuery
} from '../schemas/project';
import { NotFoundError } from '../middleware/apiMiddleware';
import ProjectModel from 'server/src/lib/models/project';
import ProjectTaskModel from 'server/src/lib/models/projectTask';
import { publishEvent, publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { OrderingService } from 'server/src/lib/services/orderingService';
import {
  buildProjectStatusChangedPayload,
  buildProjectUpdatedPayload,
} from '@shared/workflow/streams/domainEventBuilders/projectLifecycleEventBuilders';

export class ProjectService extends BaseService<IProject> {
  constructor() {
    super({
      tableName: 'projects',
      primaryKey: 'project_id',
      tenantColumn: 'tenant',
      searchableFields: ['project_name', 'description'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });
  }

  async list(options: ListOptions, context: ServiceContext, filters?: ProjectFilterData): Promise<ListResult<IProject>> {
      const { knex } = await this.getKnex();
      const query = knex(this.tableName)
        .where(`${this.tableName}.tenant`, context.tenant);
  
      // Apply filters
      if (filters) {
        if (filters.project_name) {
          query.where(`${this.tableName}.project_name`, 'ilike', `%${filters.project_name}%`);
        }
        if (filters.client_id) {
          query.where(`${this.tableName}.client_id`, filters.client_id);
        }
        if (filters.status) {
          query.where(`${this.tableName}.status`, filters.status);
        }
        if (filters.start_date_from) {
          query.where(`${this.tableName}.start_date`, '>=', filters.start_date_from);
        }
        if (filters.start_date_to) {
          query.where(`${this.tableName}.start_date`, '<=', filters.start_date_to);
        }
        if (filters.end_date_from) {
          query.where(`${this.tableName}.end_date`, '>=', filters.end_date_from);
        }
        if (filters.end_date_to) {
          query.where(`${this.tableName}.end_date`, '<=', filters.end_date_to);
        }
        if (filters.is_inactive !== undefined) {
          query.where(`${this.tableName}.is_inactive`, filters.is_inactive);
        }
        if (filters.assigned_to) {
        query.where(`${this.tableName}.assigned_to`, filters.assigned_to);
      }
      if (filters.contact_name_id) {
        query.where(`${this.tableName}.contact_name_id`, filters.contact_name_id);
      }
      if (filters.is_closed !== undefined) {
        query.where(`${this.tableName}.is_closed`, filters.is_closed);
      }
      if (filters.has_assignment !== undefined) {
        if (filters.has_assignment) {
          query.whereNotNull(`${this.tableName}.assigned_to`);
        } else {
          query.whereNull(`${this.tableName}.assigned_to`);
        }
      }
      }
  
      // Apply search from filters
    if (filters?.search) {
      query.where(subQuery => {
        subQuery.where(`${this.tableName}.project_name`, 'ilike', `%${filters.search}%`)
          .orWhere(`${this.tableName}.description`, 'ilike', `%${filters.search}%`);
      });
    }
  
      // Get total count for pagination
      const countQuery = query.clone().clearSelect().clearOrder().count('* as count');
  
      // Apply sorting
      const sortField = options.sort || 'project_name';
      const sortOrder = options.order || 'asc';
      query.orderBy(`${this.tableName}.${sortField}`, sortOrder);
  
      // Apply pagination
      const page = options.page || 1;
      const limit = options.limit || 25;
      const offset = (page - 1) * limit;
      query.limit(limit).offset(offset);
  
      const [projects, [{ count }]] = await Promise.all([
        query,
        countQuery
      ]);
  
      return {
        data: projects,
        total: parseInt(count as string)
      };
    }


  async getById(id: string, context: ServiceContext): Promise<IProject | null> {
      const { knex } = await this.getKnex();
      
      const project = await knex(this.tableName)
        .leftJoin('clients', `${this.tableName}.client_id`, 'clients.client_id')
        .leftJoin('contacts', `${this.tableName}.contact_name_id`, 'contacts.contact_name_id')
        .leftJoin('users', `${this.tableName}.assigned_to`, 'users.user_id')
        .where({
          [`${this.tableName}.${this.primaryKey}`]: id,
          [`${this.tableName}.tenant`]: context.tenant
        })
        .select(
          `${this.tableName}.*`,
          'clients.client_name as client_name',
          'contacts.full_name as contact_name',
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
        )
        .first();
  
      return project || null;
    }


  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    const project = await this.getById(id, context);
    if (!project) return null;

    const [phases, statistics, client, contact, assignedUser] = await Promise.all([
      this.getPhases(id, context),
      this.getProjectStatistics(id, context),
      this.getProjectClient(project.client_id, context),
      project.contact_name_id ? this.getProjectContact(project.contact_name_id, context) : null,
      project.assigned_to ? this.getProjectAssignedUser(project.assigned_to, context) : null
    ]);

    return {
      ...project,
      client,
      contact,
      assigned_user: assignedUser,
      phases,
      statistics
    };
  }

  async createProject(data: CreateProjectData, context: ServiceContext): Promise<IProject> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Generate WBS code
      const wbsCode = await ProjectModel.generateNextWbsCode(trx, '');
      
      // Get default status if not provided
      let status = data.status;
      if (!data.status) {
        try {
          const defaultStatus = await this.getDefaultProjectStatus(context);
          status = defaultStatus?.status_id;
        } catch (error) {
          // If status lookup fails, throw error since status is required
          console.error('Could not get default project status:', error);
          throw new Error('Unable to determine project status. Please ensure project statuses are configured.');
        }
      } else if (!this.isUUID(data.status)) {
        // Convert status name to UUID
        status = await this.resolveStatusNameToId(data.status, context);
      }
      
      // Remove fields that don't belong in the database
      const { create_default_phase, tags, budgeted_hours, ...dataForInsert } = data;
      
      const projectData: any = {
        ...dataForInsert,
        wbs_code: wbsCode,
        status: status, // Status is required in the database
        tenant: context.tenant,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [project] = await trx(this.tableName).insert(projectData).returning('*');

      // Create initial phase if needed
      if (data.create_default_phase) {
        await trx('project_phases').insert({
          phase_id: trx.raw('gen_random_uuid()'),
          project_id: project.project_id,
          phase_name: 'Initial Phase',
          description: 'Default project phase',
          start_date: project.start_date,
          end_date: project.end_date,
          status: 'active',
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        });
      }

      // Publish event
      await publishEvent({
        eventType: 'PROJECT_CREATED',
        payload: {
          tenantId: context.tenant,
          projectId: project.project_id,
          projectName: project.project_name,
          clientId: project.client_id,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });

      return project;
    });
  }

  // Override for BaseService compatibility  
  async create(data: Partial<IProject>, context: ServiceContext): Promise<IProject>;
  async create(data: CreateProjectData, context: ServiceContext): Promise<IProject>;
  async create(data: CreateProjectData | Partial<IProject>, context: ServiceContext): Promise<IProject> {
    return this.createProject(data as CreateProjectData, context);
  }

  async update(id: string, data: UpdateProjectData, context: ServiceContext): Promise<IProject> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const beforeProject = await trx(this.tableName)
          .where({ [this.primaryKey]: id, tenant: context.tenant })
          .first();
        if (!beforeProject) {
          throw new NotFoundError('Project not found');
        }

        // Handle status name to UUID conversion if needed
        let statusId = data.status;
        if (data.status && !this.isUUID(data.status)) {
          statusId = await this.resolveStatusNameToId(data.status, context);
        }

        const updateData = {
          ...data,
          status: statusId,
          updated_at: new Date()
        };
  
        const [project] = await trx(this.tableName)
          .where({ [this.primaryKey]: id, tenant: context.tenant })
          .update(updateData)
          .returning('*');
  
        if (!project) {
          throw new NotFoundError('Project not found');
        }
        
        // If status is requested in response, resolve it back to the expected format
        if (data.status && !this.isUUID(data.status)) {
          project.status = data.status;
        }
  
        const occurredAt = updateData.updated_at instanceof Date ? updateData.updated_at : new Date();
        const ctx = {
          tenantId: context.tenant,
          occurredAt,
          actor: { actorType: 'USER' as const, actorUserId: context.userId },
        };

        if ('status' in data && beforeProject.status !== project.status) {
          await publishWorkflowEvent({
            eventType: 'PROJECT_STATUS_CHANGED',
            ctx,
            payload: buildProjectStatusChangedPayload({
              projectId: id,
              previousStatus: beforeProject.status,
              newStatus: project.status,
              changedAt: occurredAt,
            }),
          });
        }

        await publishWorkflowEvent({
          eventType: 'PROJECT_UPDATED',
          ctx,
          payload: buildProjectUpdatedPayload({
            projectId: id,
            before: beforeProject as unknown as Record<string, unknown> & { project_id: string },
            after: project as unknown as Record<string, unknown> & { project_id: string },
            updatedFieldKeys: Object.keys(data),
            updatedAt: occurredAt,
          }),
        });
  
        return project;
      });
    }


  async delete(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const result = await trx(this.tableName)
          .where({ [this.primaryKey]: id, tenant: context.tenant })
          .del();
  
        if (result === 0) {
          throw new NotFoundError('Project not found');
        }
  
        // Publish event
        await publishEvent({
          eventType: 'PROJECT_DELETED',
          payload: {
            tenantId: context.tenant,
            projectId: id,
            userId: context.userId,
            timestamp: new Date().toISOString()
          }
        });
      });
    }


  // Project phases
  async getPhases(projectId: string, context: ServiceContext): Promise<IProjectPhase[]> {
      const { knex } = await this.getKnex();
      
      return knex('project_phases')
        .where({ project_id: projectId, tenant: context.tenant })
        .orderBy([
          { column: 'order_key', order: 'asc' },
          { column: 'order_number', order: 'asc' }
        ]);
    }


  async createPhase(projectId: string, data: CreateProjectPhaseData, context: ServiceContext): Promise<IProjectPhase> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const project = await this.getById(projectId, context);
        if (!project) {
          throw new NotFoundError('Project not found');
        }
  
        const phases = await this.getPhases(projectId, context);
        const nextOrderNumber = phases.length + 1;
  
        // Generate WBS code
        const phaseNumbers = phases
          .map(phase => {
            const parts = phase.wbs_code.split('.');
            return parseInt(parts[parts.length - 1]);
          })
          .filter(num => !isNaN(num));
  
        const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
        const newWbsCode = `${project.wbs_code}.${maxPhaseNumber + 1}`;
  
        // Generate order key
        let orderKey: string;
        if (phases.length === 0) {
          orderKey = OrderingService.generateKeyForPosition(null, null);
        } else {
          const sortedPhases = [...phases].sort((a, b) => {
            if (a.order_key && b.order_key) {
              return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
            }
            return 0;
          });
          const lastPhase = sortedPhases[sortedPhases.length - 1];
          orderKey = OrderingService.generateKeyForPosition(lastPhase.order_key || null, null);
        }
  
        const phaseData = {
          ...data,
          project_id: projectId,
          order_number: nextOrderNumber,
          wbs_code: newWbsCode,
          order_key: orderKey,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [phase] = await trx('project_phases')
          .insert(phaseData)
          .returning('*');
  
        return phase;
      });
    }


  async updatePhase(phaseId: string, data: UpdateProjectPhaseData, context: ServiceContext): Promise<IProjectPhase> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        const [phase] = await trx('project_phases')
          .where({ phase_id: phaseId, tenant: context.tenant })
          .update(updateData)
          .returning('*');
  
        if (!phase) {
          throw new NotFoundError('Project phase not found');
        }
  
        return phase;
      });
    }


  async deletePhase(phaseId: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const result = await knex('project_phases')
        .where({ phase_id: phaseId, tenant: context.tenant })
        .del();
  
      if (result === 0) {
        throw new NotFoundError('Project phase not found');
      }
    }


  // Project tasks
  async getTasks(projectId: string, context: ServiceContext): Promise<IProjectTask[]> {
      const { knex } = await this.getKnex();
      
      // First check if the project exists
      const project = await this.getById(projectId, context);
      if (!project) {
        throw new NotFoundError('Project not found');
      }
      
      // Check if there are any phases for this project
      const phases = await knex('project_phases')
        .where({ project_id: projectId, tenant: context.tenant })
        .select('phase_id');
        
      if (phases.length === 0) {
        // No phases means no tasks
        return [];
      }
      
      return knex('project_tasks')
        .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
        .where({
          'project_phases.project_id': projectId,
          'project_tasks.tenant': context.tenant
        })
        .select('project_tasks.*')
        .orderBy([
          { column: 'project_tasks.order_key', order: 'asc' },
          { column: 'project_tasks.order_number', order: 'asc' }
        ]);
    }


  async createTask(phaseId: string, data: CreateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const phase = await trx('project_phases')
          .where({ phase_id: phaseId, tenant: context.tenant })
          .first();
  
        if (!phase) {
          throw new NotFoundError('Phase not found');
        }
  
        const tasks = await trx('project_tasks')
          .where({ phase_id: phaseId, tenant: context.tenant });
  
        // Generate WBS code
        const taskNumbers = tasks
          .map(task => {
            const parts = task.wbs_code.split('.');
            return parseInt(parts[parts.length - 1]);
          })
          .filter(num => !isNaN(num));
  
        const maxTaskNumber = taskNumbers.length > 0 ? Math.max(...taskNumbers) : 0;
        const newWbsCode = `${phase.wbs_code}.${maxTaskNumber + 1}`;
  
        // Generate order key
        let orderKey: string;
        if (tasks.length === 0) {
          orderKey = OrderingService.generateKeyForPosition(null, null);
        } else {
          const sortedTasks = [...tasks].sort((a, b) => {
            if (a.order_key && b.order_key) {
              return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
            }
            return 0;
          });
          const lastTask = sortedTasks[sortedTasks.length - 1];
          orderKey = OrderingService.generateKeyForPosition(lastTask.order_key || null, null);
        }
  
        const taskData = {
          ...data,
          phase_id: phaseId,
          order_number: tasks.length + 1,
          wbs_code: newWbsCode,
          order_key: orderKey,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [task] = await trx('project_tasks')
          .insert(taskData)
          .returning('*');
  
        return task;
      });
    }


  async updateTask(taskId: string, data: UpdateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        const [task] = await trx('project_tasks')
          .where({ task_id: taskId, tenant: context.tenant })
          .update(updateData)
          .returning('*');
  
        if (!task) {
          throw new NotFoundError('Project task not found');
        }
  
        return task;
      });
    }


  async deleteTask(taskId: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const result = await knex('project_tasks')
        .where({ task_id: taskId, tenant: context.tenant })
        .del();
  
      if (result === 0) {
        throw new NotFoundError('Project task not found');
      }
    }


  // Task checklist items
  async getTaskChecklistItems(taskId: string, context: ServiceContext): Promise<ITaskChecklistItem[]> {
      const { knex } = await this.getKnex();
      
      return knex('task_checklist_items')
        .where({ task_id: taskId, tenant: context.tenant })
        .orderBy('order_number');
    }


  async createChecklistItem(taskId: string, data: CreateTaskChecklistItemData, context: ServiceContext): Promise<ITaskChecklistItem> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const items = await this.getTaskChecklistItems(taskId, context);
        const nextOrderNumber = data.order_number ?? items.length + 1;
  
        const itemData = {
          ...data,
          task_id: taskId,
          order_number: nextOrderNumber,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [item] = await trx('task_checklist_items')
          .insert(itemData)
          .returning('*');
  
        return item;
      });
    }


  // Project ticket links
  async getProjectTicketLinks(projectId: string, context: ServiceContext): Promise<IProjectTicketLink[]> {
      const { knex } = await this.getKnex();
      
      return knex('project_ticket_links')
        .leftJoin('tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id')
        .leftJoin('clients', 'tickets.client_id', 'clients.client_id')
        .where({
          'project_ticket_links.project_id': projectId,
          'project_ticket_links.tenant': context.tenant
        })
        .select(
          'project_ticket_links.*',
          'tickets.title as ticket_title',
          'tickets.ticket_number',
          'tickets.status as ticket_status',
          'clients.client_name'
        );
    }


  async createTicketLink(projectId: string, data: CreateProjectTicketLinkData, context: ServiceContext): Promise<IProjectTicketLink> {
      const { knex } = await this.getKnex();
      
      const linkData = {
        ...data,
        project_id: projectId,
        tenant: context.tenant,
        created_at: new Date()
      };
  
      const [link] = await knex('project_ticket_links')
        .insert(linkData)
        .returning('*');
  
      return link;
    }


  // Search and export
  async search(searchData: ProjectSearchData, context: ServiceContext): Promise<IProject[]> {
      const { knex } = await this.getKnex();
      const tableName = this.tableName; // Capture tableName in scope
      
      const query = knex(tableName)
        .where(`${tableName}.tenant`, context.tenant);
  
      // Build search query
      if (searchData.fields && searchData.fields.length > 0) {
        query.where(function() {
          searchData.fields!.forEach(field => {
            if (field === 'client_name') {
              this.orWhere('clients.client_name', 'ilike', `%${searchData.query}%`);
            } else {
              this.orWhere(`${tableName}.${field}`, 'ilike', `%${searchData.query}%`);
            }
          });
        });
      } else {
        // Default search across all text fields
        query.where(function() {
          this.orWhere(`${tableName}.project_name`, 'ilike', `%${searchData.query}%`)
            .orWhere(`${tableName}.description`, 'ilike', `%${searchData.query}%`)
            .orWhere(`${tableName}.wbs_code`, 'ilike', `%${searchData.query}%`);
        });
      }
  
      // Apply filters
      if (searchData.status && searchData.status.length > 0) {
        query.whereIn(`${tableName}.status`, searchData.status);
      }
      if (searchData.client_ids && searchData.client_ids.length > 0) {
        query.whereIn(`${tableName}.client_id`, searchData.client_ids);
      }
      if (searchData.assigned_to_ids && searchData.assigned_to_ids.length > 0) {
        query.whereIn(`${tableName}.assigned_to`, searchData.assigned_to_ids);
      }
      if (!searchData.include_inactive) {
        query.where(`${tableName}.is_inactive`, false);
      }
  
      // Add client join for client name search
      query.leftJoin('clients', `${tableName}.client_id`, 'clients.client_id')
        .select(`${tableName}.*`, 'clients.client_name')
        .orderBy(`${tableName}.project_name`)
        .limit(searchData.limit || 25);
  
      return query;
    }


  // Statistics
  async getStatistics(context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const tableName = this.tableName;
      
      const stats = await knex(tableName)
        .leftJoin('statuses', function() {
          this.on(`${tableName}.status`, '=', 'statuses.status_id')
              .andOn(`${tableName}.tenant`, '=', 'statuses.tenant');
        })
        .where(`${tableName}.tenant`, context.tenant)
        .select([
          knex.raw('COUNT(*) as total_projects'),
          knex.raw(`COUNT(CASE WHEN statuses.name = 'Active' THEN 1 END) as active_projects`),
          knex.raw(`COUNT(CASE WHEN statuses.name = 'Completed' THEN 1 END) as completed_projects`),
          knex.raw(`COUNT(CASE WHEN statuses.name = 'On Hold' THEN 1 END) as on_hold_projects`),
          knex.raw(`COUNT(CASE WHEN statuses.name = 'Cancelled' THEN 1 END) as cancelled_projects`),
          knex.raw(`COUNT(CASE WHEN ${tableName}.end_date < NOW() AND statuses.name != 'Completed' THEN 1 END) as overdue_projects`),
          knex.raw(`SUM(${tableName}.budgeted_hours) as total_budgeted_hours`),
          knex.raw(`COUNT(CASE WHEN ${tableName}.created_at >= date_trunc('month', NOW()) THEN 1 END) as projects_created_this_month`),
          knex.raw(`COUNT(CASE WHEN statuses.name = 'Completed' AND ${tableName}.updated_at >= date_trunc('month', NOW()) THEN 1 END) as projects_completed_this_month`)
        ])
        .first();
  
      // Get projects by status
      const projectsByStatus = await knex(tableName)
        .leftJoin('statuses', function() {
          this.on(`${tableName}.status`, '=', 'statuses.status_id')
              .andOn(`${tableName}.tenant`, '=', 'statuses.tenant');
        })
        .where(`${tableName}.tenant`, context.tenant)
        .groupBy('statuses.name')
        .select('statuses.name as status', knex.raw('COUNT(*) as count'));
  
      // Get projects by client
      const projectsByClient = await knex(tableName)
        .join('clients', `${tableName}.client_id`, 'clients.client_id')
        .where(`${tableName}.tenant`, context.tenant)
        .groupBy('clients.client_name')
        .select('clients.client_name', knex.raw('COUNT(*) as count'))
        .limit(10);
  
      return {
        total_projects: parseInt(stats.total_projects as string),
        active_projects: parseInt(stats.active_projects as string),
        completed_projects: parseInt(stats.completed_projects as string),
        on_hold_projects: parseInt(stats.on_hold_projects as string),
        cancelled_projects: parseInt(stats.cancelled_projects as string),
        overdue_projects: parseInt(stats.overdue_projects as string),
        total_budgeted_hours: parseFloat(stats.total_budgeted_hours as string) || 0,
        projects_created_this_month: parseInt(stats.projects_created_this_month as string),
        projects_completed_this_month: parseInt(stats.projects_completed_this_month as string),
        projects_by_status: projectsByStatus.reduce((acc: any, row: any) => {
          acc[row.status] = parseInt(row.count);
          return acc;
        }, {}),
        top_clients_by_project_count: projectsByClient.map((row: any) => ({
          client_name: row.client_name,
          project_count: parseInt(row.count)
        }))
      };
    }


  // Helper methods
  private async getDefaultProjectStatus(context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      // First try to find a status marked as default
      let status = await knex('statuses')
        .where({ 
          tenant: context.tenant,
          item_type: 'project',
          is_default: true
        })
        .first();
      
      // If no default status, get the first one by order
      if (!status) {
        status = await knex('statuses')
          .where({ 
            tenant: context.tenant,
            item_type: 'project'
          })
          .orderBy('order_number')
          .first();
      }
  
      if (!status) {
        throw new Error('No default project status found');
      }
  
      return status;
    }

  // Helper method to check if a string is a valid UUID
  private isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  // Helper method to resolve status names to UUIDs
  private async resolveStatusNameToId(statusName: string, context: ServiceContext): Promise<string> {
    const { knex } = await this.getKnex();
    
    // Map common status names to database names
    const statusNameMap: Record<string, string> = {
      'planning': 'Planning',
      'active': 'Active', 
      'on_hold': 'On Hold',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'in_progress': 'Active' // Map in_progress to Active
    };

    const dbStatusName = statusNameMap[statusName.toLowerCase()] || statusName;
    
    const status = await knex('statuses')
      .where({
        tenant: context.tenant,
        item_type: 'project',
        name: dbStatusName
      })
      .first();

    if (!status) {
      throw new Error(`Invalid status: ${statusName}`);
    }

    return status.status_id;
  }


  private async setupDefaultStatusMappings(projectId: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const standardStatuses = await knex('standard_statuses')
        .where({ item_type: 'project_task' })
        .orderBy('display_order');
  
      for (const status of standardStatuses) {
        await knex('project_status_mappings').insert({
          project_id: projectId,
          standard_status_id: status.standard_status_id,
          is_standard: true,
          custom_name: null,
          display_order: status.display_order,
          is_visible: true,
          tenant: context.tenant
        });
      }
    }


  private async getProjectStatistics(projectId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const [phaseCount, taskStats] = await Promise.all([
        knex('project_phases')
          .where({ project_id: projectId, tenant: context.tenant })
          .count('* as count')
          .first(),
        knex('project_tasks')
          .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
          .where({
            'project_phases.project_id': projectId,
            'project_tasks.tenant': context.tenant
          })
          .select([
            knex.raw('COUNT(*) as total_tasks'),
            knex.raw(`COUNT(CASE WHEN project_status_mapping.is_closed THEN 1 END) as completed_tasks`),
            knex.raw('SUM(project_tasks.estimated_hours) as total_estimated_hours'),
            knex.raw('SUM(project_tasks.actual_hours) as total_actual_hours')
          ])
          .leftJoin('project_status_mappings', 'project_tasks.project_status_mapping_id', 'project_status_mappings.project_status_mapping_id')
          .leftJoin('standard_statuses', 'project_status_mappings.standard_status_id', 'standard_statuses.standard_status_id')
          .first()
      ]);
  
      const totalTasks = parseInt(taskStats?.total_tasks || '0');
      const completedTasks = parseInt(taskStats?.completed_tasks || '0');
  
      return {
        phase_count: parseInt(phaseCount?.count+'' || '0'),
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        pending_tasks: totalTasks - completedTasks,
        completion_percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        total_estimated_hours: parseFloat(taskStats?.total_estimated_hours || '0'),
        total_actual_hours: parseFloat(taskStats?.total_actual_hours || '0')
      };
    }


  private async getProjectClient(clientId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return knex('clients')
        .where({ client_id: clientId, tenant: context.tenant })
        .select('client_id', 'client_name', 'email', 'phone_no')
        .first();
    }


  private async getProjectContact(contactId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return knex('contacts')
        .where({ contact_name_id: contactId, tenant: context.tenant })
        .select('contact_name_id', 'full_name', 'email', 'phone_number')
        .first();
    }


  private async getProjectAssignedUser(userId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return knex('users')
        .where({ user_id: userId })
        .select('user_id', 'first_name', 'last_name', 'email')
        .first();
    }

  // Service method aliases for controller compatibility
  async searchProjects(searchData: any, context: ServiceContext): Promise<any[]> {
    return this.search(searchData, context);
  }

  async getProjectStats(context: ServiceContext): Promise<any> {
    return this.getStatistics(context);
  }

  async exportProjects(filters: any, format: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const query = knex(this.tableName)
      .leftJoin('clients', `${this.tableName}.client_id`, 'clients.client_id')
      .leftJoin('contacts', `${this.tableName}.contact_name_id`, 'contacts.contact_name_id')
      .leftJoin('users', `${this.tableName}.assigned_to`, 'users.user_id')
      .where(`${this.tableName}.tenant`, context.tenant)
      .select(
        `${this.tableName}.*`,
        'clients.client_name',
        'contacts.full_name as contact_name',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
      )
      .orderBy(`${this.tableName}.project_name`);

    // Apply filters
    if (filters.project_name) {
      query.where(`${this.tableName}.project_name`, 'ilike', `%${filters.project_name}%`);
    }
    if (filters.client_id) {
      query.where(`${this.tableName}.client_id`, filters.client_id);
    }
    if (filters.status) {
      query.where(`${this.tableName}.status`, filters.status);
    }
    if (filters.assigned_to) {
      query.where(`${this.tableName}.assigned_to`, filters.assigned_to);
    }
    if (filters.start_date_from) {
      query.where(`${this.tableName}.start_date`, '>=', filters.start_date_from);
    }
    if (filters.start_date_to) {
      query.where(`${this.tableName}.start_date`, '<=', filters.start_date_to);
    }
    if (filters.is_inactive !== undefined) {
      query.where(`${this.tableName}.is_inactive`, filters.is_inactive);
    }

    const projects = await query;

    if (format === 'csv') {
      return this.convertToCSV(projects);
    }

    return projects;
  }

  async getProjectTasks(projectId: string, context: ServiceContext): Promise<any[]> {
    // Use existing getTasks method
    return this.getTasks(projectId, context);
  }

  async getProjectTickets(projectId: string, pagination: any, context: ServiceContext): Promise<{data: any[], total: number}> {
    const { knex } = await this.getKnex();
    
    // Get tickets related to this project through project_ticket_links
    const baseQuery = knex('project_ticket_links')
      .leftJoin('tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id')
      .leftJoin('clients', 'tickets.client_id', 'clients.client_id')
      .leftJoin('users', 'tickets.assigned_to', 'users.user_id')
      .where({
        'project_ticket_links.project_id': projectId,
        'project_ticket_links.tenant': context.tenant
      })
      .select(
        'tickets.*',
        'clients.client_name',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`),
        'project_ticket_links.created_at as link_created_at'
      );

    // Get total count
    const countQuery = baseQuery.clone().clearSelect().count('* as count');
    const [{ count }] = await countQuery;

    // Apply pagination
    const page = pagination.page || 1;
    const limit = pagination.limit || 25;
    const offset = (page - 1) * limit;
    
    const tickets = await baseQuery
      .limit(limit)
      .offset(offset)
      .orderBy('project_ticket_links.created_at', 'desc');

    return {
      data: tickets,
      total: parseInt(count as string)
    };
  }

  // Helper method to convert data to CSV
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }

  /**
   * Bulk update projects - custom implementation
   */
  async bulkUpdateProjects(projectIds: string[], updates: any, context: ServiceContext): Promise<IProject[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: IProject[] = [];
      
      for (const projectId of projectIds) {
        const project = await this.update(projectId, updates, context);
        results.push(project);
      }
      
      return results;
    });
  }

  /**
   * Bulk assign projects
   */
  async bulkAssign(projectIds: string[], assignToUserId: string, context: ServiceContext): Promise<IProject[]> {
    return this.bulkUpdateProjects(projectIds, { assigned_to: assignToUserId }, context);
  }

  /**
   * Bulk status update
   */
  async bulkStatusUpdate(projectIds: string[], status: string, context: ServiceContext): Promise<IProject[]> {
    return this.bulkUpdateProjects(projectIds, { status }, context);
  }

  /**
   * List project phases
   */
  async listPhases(projectId: string, context: ServiceContext): Promise<IProjectPhase[]> {
    return this.getPhases(projectId, context);
  }

  /**
   * List tasks for a phase
   */
  async listPhaseTasks(phaseId: string, context: ServiceContext): Promise<IProjectTask[]> {
    const { knex } = await this.getKnex();
    
    const tasks = await knex('project_tasks')
      .where({
        phase_id: phaseId,
        tenant: context.tenant
      })
      .orderBy('sort_order');

    return tasks;
  }

  /**
   * Get task by ID
   */
  async getTaskById(taskId: string, context: ServiceContext): Promise<IProjectTask | null> {
    const { knex } = await this.getKnex();
    
    const task = await knex('project_tasks')
      .where({
        task_id: taskId,
        tenant: context.tenant
      })
      .first();

    return task || null;
  }


}

/**
 * Project API Service
 * Handles all project-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult } from './BaseService';
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
import ProjectModel from 'server/src/lib/models/project';
import ProjectTaskModel from 'server/src/lib/models/projectTask';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { OrderingService } from 'server/src/lib/services/orderingService';

export class ProjectService extends BaseService<IProject> {
  protected tableName = 'projects';
  protected primaryKey = 'project_id';

  async list(options: ListOptions, context: ServiceContext, filters?: ProjectFilterData): Promise<ListResult<IProject>> {
    const query = context.db(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    // Apply filters
    if (filters) {
      if (filters.project_name) {
        query.where(`${this.tableName}.project_name`, 'ilike', `%${filters.project_name}%`);
      }
      if (filters.company_id) {
        query.where(`${this.tableName}.company_id`, filters.company_id);
      }
      if (filters.status) {
        query.where(`${this.tableName}.status`, filters.status);
      }
      if (filters.assigned_to) {
        query.where(`${this.tableName}.assigned_to`, filters.assigned_to);
      }
      if (filters.contact_name_id) {
        query.where(`${this.tableName}.contact_name_id`, filters.contact_name_id);
      }
      if (filters.is_inactive !== undefined) {
        query.where(`${this.tableName}.is_inactive`, filters.is_inactive);
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
      if (filters.budgeted_hours_min !== undefined) {
        query.where(`${this.tableName}.budgeted_hours`, '>=', filters.budgeted_hours_min);
      }
      if (filters.budgeted_hours_max !== undefined) {
        query.where(`${this.tableName}.budgeted_hours`, '<=', filters.budgeted_hours_max);
      }
      if (filters.wbs_code) {
        query.where(`${this.tableName}.wbs_code`, 'ilike', `%${filters.wbs_code}%`);
      }
      if (filters.company_name) {
        query.join('companies', `${this.tableName}.company_id`, 'companies.company_id')
          .where('companies.company_name', 'ilike', `%${filters.company_name}%`);
      }
      if (filters.contact_name) {
        query.join('contacts', `${this.tableName}.contact_name_id`, 'contacts.contact_name_id')
          .where('contacts.full_name', 'ilike', `%${filters.contact_name}%`);
      }
    }

    // Add joins for additional data
    query.leftJoin('companies', `${this.tableName}.company_id`, 'companies.company_id')
      .leftJoin('contacts', `${this.tableName}.contact_name_id`, 'contacts.contact_name_id')
      .leftJoin('users', `${this.tableName}.assigned_to`, 'users.user_id')
      .select(
        `${this.tableName}.*`,
        'companies.company_name as client_name',
        'contacts.full_name as contact_name',
        context.db.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
      );

    return this.executeListQuery(query, options);
  }

  async getById(id: string, context: ServiceContext): Promise<IProject | null> {
    const project = await context.db(this.tableName)
      .leftJoin('companies', `${this.tableName}.company_id`, 'companies.company_id')
      .leftJoin('contacts', `${this.tableName}.contact_name_id`, 'contacts.contact_name_id')
      .leftJoin('users', `${this.tableName}.assigned_to`, 'users.user_id')
      .where({
        [`${this.tableName}.${this.primaryKey}`]: id,
        [`${this.tableName}.tenant`]: context.tenant
      })
      .select(
        `${this.tableName}.*`,
        'companies.company_name as client_name',
        'contacts.full_name as contact_name',
        context.db.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
      )
      .first();

    return project || null;
  }

  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    const project = await this.getById(id, context);
    if (!project) return null;

    const [phases, statistics, company, contact, assignedUser] = await Promise.all([
      this.getPhases(id, context),
      this.getProjectStatistics(id, context),
      this.getProjectCompany(project.company_id, context),
      project.contact_name_id ? this.getProjectContact(project.contact_name_id, context) : null,
      project.assigned_to ? this.getProjectAssignedUser(project.assigned_to, context) : null
    ]);

    return {
      ...project,
      company,
      contact,
      assigned_user: assignedUser,
      phases,
      statistics
    };
  }

  async create(data: CreateProjectData, context: ServiceContext): Promise<IProject> {
    // Generate WBS code
    const wbsCode = await ProjectModel.generateNextWbsCode(context.db, '');
    
    // Get default status
    const defaultStatus = await this.getDefaultProjectStatus(context);
    
    const projectData = {
      ...data,
      wbs_code: wbsCode,
      status: defaultStatus.status_id,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    const [project] = await context.db(this.tableName)
      .insert(projectData)
      .returning('*');

    // Set up default project status mappings
    await this.setupDefaultStatusMappings(project.project_id, context);

    // Publish event
    await publishEvent({
      eventType: 'PROJECT_CREATED',
      payload: {
        tenantId: context.tenant,
        projectId: project.project_id,
        userId: context.userId,
        timestamp: new Date().toISOString()
      }
    });

    return this.getById(project.project_id, context) as Promise<IProject>;
  }

  async update(id: string, data: UpdateProjectData, context: ServiceContext): Promise<IProject> {
    const updateData = {
      ...data,
      updated_at: new Date()
    };

    await context.db(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
      .update(updateData);

    // Publish event
    await publishEvent({
      eventType: 'PROJECT_UPDATED',
      payload: {
        tenantId: context.tenant,
        projectId: id,
        userId: context.userId,
        changes: data,
        timestamp: new Date().toISOString()
      }
    });

    return this.getById(id, context) as Promise<IProject>;
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    await context.db(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
      .del();

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
  }

  // Project phases
  async getPhases(projectId: string, context: ServiceContext): Promise<IProjectPhase[]> {
    return context.db('project_phases')
      .where({ project_id: projectId, tenant: context.tenant })
      .orderBy([
        { column: 'order_key', order: 'asc' },
        { column: 'order_number', order: 'asc' }
      ]);
  }

  async createPhase(projectId: string, data: CreateProjectPhaseData, context: ServiceContext): Promise<IProjectPhase> {
    const project = await this.getById(projectId, context);
    if (!project) {
      throw new Error('Project not found');
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

    const [phase] = await context.db('project_phases')
      .insert(phaseData)
      .returning('*');

    return phase;
  }

  async updatePhase(phaseId: string, data: UpdateProjectPhaseData, context: ServiceContext): Promise<IProjectPhase> {
    const updateData = {
      ...data,
      updated_at: new Date()
    };

    await context.db('project_phases')
      .where({ phase_id: phaseId, tenant: context.tenant })
      .update(updateData);

    const phase = await context.db('project_phases')
      .where({ phase_id: phaseId, tenant: context.tenant })
      .first();

    return phase;
  }

  async deletePhase(phaseId: string, context: ServiceContext): Promise<void> {
    await context.db('project_phases')
      .where({ phase_id: phaseId, tenant: context.tenant })
      .del();
  }

  // Project tasks
  async getTasks(projectId: string, context: ServiceContext): Promise<IProjectTask[]> {
    return context.db('project_tasks')
      .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
      .where({
        'project_phases.project_id': projectId,
        'project_tasks.tenant': context.tenant
      })
      .select('project_tasks.*')
      .orderBy([
        { column: 'project_phases.order_key', order: 'asc' },
        { column: 'project_tasks.order_key', order: 'asc' }
      ]);
  }

  async createTask(phaseId: string, data: CreateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
    const phase = await context.db('project_phases')
      .where({ phase_id: phaseId, tenant: context.tenant })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    const tasks = await context.db('project_tasks')
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
      wbs_code: newWbsCode,
      order_key: orderKey,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    const [task] = await context.db('project_tasks')
      .insert(taskData)
      .returning('*');

    return task;
  }

  async updateTask(taskId: string, data: UpdateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
    const updateData = {
      ...data,
      updated_at: new Date()
    };

    await context.db('project_tasks')
      .where({ task_id: taskId, tenant: context.tenant })
      .update(updateData);

    const task = await context.db('project_tasks')
      .where({ task_id: taskId, tenant: context.tenant })
      .first();

    return task;
  }

  async deleteTask(taskId: string, context: ServiceContext): Promise<void> {
    await context.db('project_tasks')
      .where({ task_id: taskId, tenant: context.tenant })
      .del();
  }

  // Task checklist items
  async getTaskChecklistItems(taskId: string, context: ServiceContext): Promise<ITaskChecklistItem[]> {
    return context.db('task_checklist_items')
      .where({ task_id: taskId, tenant: context.tenant })
      .orderBy('order_number');
  }

  async createChecklistItem(taskId: string, data: CreateTaskChecklistItemData, context: ServiceContext): Promise<ITaskChecklistItem> {
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

    const [item] = await context.db('task_checklist_items')
      .insert(itemData)
      .returning('*');

    return item;
  }

  // Project ticket links
  async getProjectTicketLinks(projectId: string, context: ServiceContext): Promise<IProjectTicketLink[]> {
    return context.db('project_ticket_links')
      .leftJoin('tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id')
      .leftJoin('companies', 'tickets.company_id', 'companies.company_id')
      .where({
        'project_ticket_links.project_id': projectId,
        'project_ticket_links.tenant': context.tenant
      })
      .select(
        'project_ticket_links.*',
        'tickets.ticket_number',
        'tickets.title',
        'tickets.status_name',
        'tickets.priority_name',
        'companies.company_name'
      );
  }

  async createTicketLink(projectId: string, data: CreateProjectTicketLinkData, context: ServiceContext): Promise<IProjectTicketLink> {
    const linkData = {
      ...data,
      project_id: projectId,
      tenant: context.tenant,
      created_at: new Date()
    };

    const [link] = await context.db('project_ticket_links')
      .insert(linkData)
      .returning('*');

    return link;
  }

  // Search and export
  async search(searchData: ProjectSearchData, context: ServiceContext): Promise<IProject[]> {
    const query = context.db(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    // Build search query
    if (searchData.fields && searchData.fields.length > 0) {
      query.where(function() {
        searchData.fields!.forEach(field => {
          if (field === 'company_name') {
            this.orWhere('companies.company_name', 'ilike', `%${searchData.query}%`);
          } else {
            this.orWhere(`${this.tableName}.${field}`, 'ilike', `%${searchData.query}%`);
          }
        });
      });
    } else {
      // Default search across all text fields
      query.where(function() {
        this.orWhere(`${this.tableName}.project_name`, 'ilike', `%${searchData.query}%`)
          .orWhere(`${this.tableName}.description`, 'ilike', `%${searchData.query}%`)
          .orWhere(`${this.tableName}.wbs_code`, 'ilike', `%${searchData.query}%`);
      });
    }

    // Apply filters
    if (searchData.status && searchData.status.length > 0) {
      query.whereIn(`${this.tableName}.status`, searchData.status);
    }
    if (searchData.company_ids && searchData.company_ids.length > 0) {
      query.whereIn(`${this.tableName}.company_id`, searchData.company_ids);
    }
    if (searchData.assigned_to_ids && searchData.assigned_to_ids.length > 0) {
      query.whereIn(`${this.tableName}.assigned_to`, searchData.assigned_to_ids);
    }
    if (!searchData.include_inactive) {
      query.where(`${this.tableName}.is_inactive`, false);
    }

    // Add joins for searching
    query.leftJoin('companies', `${this.tableName}.company_id`, 'companies.company_id')
      .select(`${this.tableName}.*`, 'companies.company_name as client_name')
      .limit(searchData.limit || 25);

    return query;
  }

  // Statistics
  async getStatistics(context: ServiceContext): Promise<any> {
    const stats = await context.db(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant)
      .select([
        context.db.raw('COUNT(*) as total_projects'),
        context.db.raw(`COUNT(CASE WHEN status = 'active' THEN 1 END) as active_projects`),
        context.db.raw(`COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_projects`),
        context.db.raw(`COUNT(CASE WHEN status = 'on_hold' THEN 1 END) as on_hold_projects`),
        context.db.raw(`COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_projects`),
        context.db.raw(`COUNT(CASE WHEN end_date < NOW() AND status != 'completed' THEN 1 END) as overdue_projects`),
        context.db.raw('SUM(budgeted_hours) as total_budgeted_hours'),
        context.db.raw(`COUNT(CASE WHEN created_at >= date_trunc('month', NOW()) THEN 1 END) as projects_created_this_month`),
        context.db.raw(`COUNT(CASE WHEN status = 'completed' AND updated_at >= date_trunc('month', NOW()) THEN 1 END) as projects_completed_this_month`)
      ])
      .first();

    // Get projects by status
    const projectsByStatus = await context.db(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant)
      .groupBy('status')
      .select('status', context.db.raw('COUNT(*) as count'));

    // Get projects by company
    const projectsByCompany = await context.db(this.tableName)
      .join('companies', `${this.tableName}.company_id`, 'companies.company_id')
      .where(`${this.tableName}.tenant`, context.tenant)
      .groupBy('companies.company_name')
      .select('companies.company_name', context.db.raw('COUNT(*) as count'))
      .limit(10);

    return {
      ...stats,
      projects_by_status: projectsByStatus.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      projects_by_company: projectsByCompany.reduce((acc, item) => {
        acc[item.company_name] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      average_project_duration: null, // Calculate if needed
      total_actual_hours: 0 // Calculate from time entries if needed
    };
  }

  // Helper methods
  private async getDefaultProjectStatus(context: ServiceContext): Promise<any> {
    const status = await context.db('statuses')
      .where({ 
        tenant: context.tenant,
        item_type: 'project',
        is_active: true
      })
      .orderBy('display_order')
      .first();

    if (!status) {
      throw new Error('No default project status found');
    }

    return status;
  }

  private async setupDefaultStatusMappings(projectId: string, context: ServiceContext): Promise<void> {
    const standardStatuses = await context.db('standard_statuses')
      .where({ item_type: 'project_task', is_active: true })
      .orderBy('display_order');

    for (const status of standardStatuses) {
      await context.db('project_status_mappings').insert({
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
    const [phaseCount, taskStats] = await Promise.all([
      context.db('project_phases')
        .where({ project_id: projectId, tenant: context.tenant })
        .count('* as count')
        .first(),
      context.db('project_tasks')
        .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
        .where({
          'project_phases.project_id': projectId,
          'project_tasks.tenant': context.tenant
        })
        .select([
          context.db.raw('COUNT(*) as total_tasks'),
          context.db.raw(`COUNT(CASE WHEN project_status_mapping.is_closed THEN 1 END) as completed_tasks`),
          context.db.raw('SUM(project_tasks.estimated_hours) as total_estimated_hours'),
          context.db.raw('SUM(project_tasks.actual_hours) as total_actual_hours')
        ])
        .leftJoin('project_status_mappings', 'project_tasks.project_status_mapping_id', 'project_status_mappings.project_status_mapping_id')
        .leftJoin('standard_statuses', 'project_status_mappings.standard_status_id', 'standard_statuses.standard_status_id')
        .first()
    ]);

    const totalTasks = parseInt(taskStats?.total_tasks || '0');
    const completedTasks = parseInt(taskStats?.completed_tasks || '0');

    return {
      total_phases: parseInt(phaseCount?.count || '0'),
      total_tasks: totalTasks,
      completed_tasks: completedTasks,
      total_estimated_hours: parseFloat(taskStats?.total_estimated_hours || '0'),
      total_actual_hours: parseFloat(taskStats?.total_actual_hours || '0'),
      progress_percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };
  }

  private async getProjectCompany(companyId: string, context: ServiceContext): Promise<any> {
    return context.db('companies')
      .where({ company_id: companyId, tenant: context.tenant })
      .select('company_id', 'company_name', 'email', 'phone_no')
      .first();
  }

  private async getProjectContact(contactId: string, context: ServiceContext): Promise<any> {
    return context.db('contacts')
      .where({ contact_name_id: contactId, tenant: context.tenant })
      .select('contact_name_id', 'full_name', 'email', 'phone_number')
      .first();
  }

  private async getProjectAssignedUser(userId: string, context: ServiceContext): Promise<any> {
    return context.db('users')
      .where({ user_id: userId })
      .select('user_id', 'first_name', 'last_name', 'email')
      .first();
  }
}
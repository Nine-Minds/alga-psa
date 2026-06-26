/**
 * Project API Service
 * Handles all project-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult, tenantDb, withTransaction } from '@alga-psa/db';
import { 
  IProject, 
  IProjectPhase, 
  IProjectStatusMapping,
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
import { ProjectModel } from '@alga-psa/projects/models';
import { publishEvent, publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { OrderingService } from 'server/src/lib/services/orderingService';
import { SharedNumberingService } from '@shared/services/numberingService';
import {
  buildProjectStatusChangedPayload,
  buildProjectUpdatedPayload,
} from '@alga-psa/workflow-streams';
import {
  buildProjectTaskAssignedPayload,
  buildProjectTaskCompletedPayload,
  buildProjectTaskCreatedPayload,
  buildProjectTaskStatusChangedPayload,
} from '@alga-psa/workflow-streams';

type InternalUpdateProjectTaskData = UpdateProjectTaskData & {
  description_rich_text?: string | null;
};

type DeferredWorkflowEvent = {
  eventType: Parameters<typeof publishWorkflowEvent>[0]['eventType'];
  payload: Record<string, unknown>;
};

function scopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table<Row>(tableExpression) as Knex.QueryBuilder<any, any>;
}

async function resolveUserName(
  trx: Knex.Transaction,
  tenant: string,
  userId: string | undefined
): Promise<string | undefined> {
  if (!userId) return undefined;
  const user = await scopedTable<{ first_name: string; last_name: string }>(trx, tenant, 'users')
    .where({ user_id: userId, is_inactive: false })
    .select('first_name', 'last_name')
    .first<{ first_name: string; last_name: string }>();
  if (user?.first_name && user?.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  return undefined;
}

async function resolveProjectStatusInfo(
  trx: Knex.Transaction,
  tenant: string,
  projectStatusMappingId: string
): Promise<{ status: string; isClosed: boolean }> {
  const db = tenantDb(trx, tenant);
  const query = db.table('project_status_mappings as psm');
  db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });

  const row = await query
    .leftJoin('standard_statuses as ss', function joinStandardStatuses(this: Knex.JoinClause) {
      this.on('psm.standard_status_id', '=', 'ss.standard_status_id');
    })
    .where({ 'psm.project_status_mapping_id': projectStatusMappingId })
    .select(
      trx.raw(
        'COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as status_name'
      ),
      trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    )
    .first<{ status_name: string; is_closed: boolean }>();

  if (!row) {
    return { status: projectStatusMappingId, isClosed: false };
  }

  return { status: row.status_name, isClosed: Boolean(row.is_closed) };
}

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
      const query = scopedTable<IProject>(knex, context.tenant, this.tableName);
  
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
      const tableName = this.tableName;

      const db = tenantDb(knex, context.tenant);
      const projectQuery = db.table<IProject>(tableName);
      db.tenantJoin(projectQuery, 'clients', `${tableName}.client_id`, 'clients.client_id', {
        type: 'left',
        rootTenantColumn: `${tableName}.tenant`,
      });
      db.tenantJoin(projectQuery, 'contacts', `${tableName}.contact_name_id`, 'contacts.contact_name_id', {
        type: 'left',
        rootTenantColumn: `${tableName}.tenant`,
      });
      db.tenantJoin(projectQuery, 'users', `${tableName}.assigned_to`, 'users.user_id', {
        type: 'left',
        rootTenantColumn: `${tableName}.tenant`,
      });

      const project = await projectQuery
        .where({
          [`${tableName}.${this.primaryKey}`]: id
        })
        .select(
          `${tableName}.*`,
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
    
    const project = await withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const projectNumber = data.project_number ?? await SharedNumberingService.getNextNumber('PROJECT', { knex: trx, tenant: context.tenant });

      // Generate WBS code
      const wbsCode = await ProjectModel.generateNextWbsCode(trx, context.tenant, '');
      
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
        project_number: projectNumber,
        status: status, // Status is required in the database
        tenant: context.tenant,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [project] = await db.table(this.tableName).insert(projectData).returning('*');

      // Create initial phase if needed
      if (data.create_default_phase) {
        const phaseWbsCode = await ProjectModel.generateNextWbsCode(trx, context.tenant, project.wbs_code);
        await db.table('project_phases').insert({
          phase_id: trx.raw('gen_random_uuid()'),
          project_id: project.project_id,
          phase_name: 'Initial Phase',
          description: 'Default project phase',
          start_date: project.start_date,
          end_date: project.end_date,
          status: 'active',
          order_number: 1,
          wbs_code: phaseWbsCode,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        });
      }

      return project;
    });

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
  }

  // Override for BaseService compatibility  
  async create(data: Partial<IProject>, context: ServiceContext): Promise<IProject>;
  async create(data: CreateProjectData, context: ServiceContext): Promise<IProject>;
  async create(data: CreateProjectData | Partial<IProject>, context: ServiceContext): Promise<IProject> {
    return this.createProject(data as CreateProjectData, context);
  }

  async update(id: string, data: UpdateProjectData, context: ServiceContext): Promise<IProject> {
      const { knex } = await this.getKnex();
      
      const result = await withTransaction(knex, async (trx) => {
        const db = tenantDb(trx, context.tenant);
        const beforeProject = await db.table(this.tableName)
          .where({ [this.primaryKey]: id })
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
  
        const [project] = await db.table(this.tableName)
          .where({ [this.primaryKey]: id })
          .update(updateData)
          .returning('*');
  
        if (!project) {
          throw new NotFoundError('Project not found');
        }
        
        // If status is requested in response, resolve it back to the expected format
        if (data.status && !this.isUUID(data.status)) {
          project.status = data.status;
        }
  
        return { beforeProject, project, occurredAt: updateData.updated_at };
      });

      const occurredAt = result.occurredAt instanceof Date ? result.occurredAt : new Date();
      const ctx = {
        tenantId: context.tenant,
        occurredAt,
        actor: { actorType: 'USER' as const, actorUserId: context.userId },
      };

      if (
        'assigned_to' in data &&
        result.beforeProject.assigned_to !== result.project.assigned_to &&
        result.project.assigned_to
      ) {
        await publishEvent({
          eventType: 'PROJECT_ASSIGNED',
          payload: {
            tenantId: context.tenant,
            projectId: id,
            userId: context.userId,
            assignedTo: result.project.assigned_to,
            timestamp: new Date().toISOString()
          }
        });
      }

      if ('status' in data && result.beforeProject.status !== result.project.status) {
        await publishWorkflowEvent({
          eventType: 'PROJECT_STATUS_CHANGED',
          ctx,
          payload: buildProjectStatusChangedPayload({
            projectId: id,
            previousStatus: result.beforeProject.status,
            newStatus: result.project.status,
            changedAt: occurredAt,
          }),
        });
      }

      await publishWorkflowEvent({
        eventType: 'PROJECT_UPDATED',
        ctx,
        payload: buildProjectUpdatedPayload({
          projectId: id,
          before: result.beforeProject as unknown as Record<string, unknown> & { project_id: string },
          after: result.project as unknown as Record<string, unknown> & { project_id: string },
          updatedFieldKeys: Object.keys(data),
          updatedAt: occurredAt,
        }),
      });

      return result.project as IProject;
    }


  // TODO: This bare DELETE has the same gap that was fixed for tickets — it
  // skips dependency validation and child-row cleanup. A project with blocking
  // records (phases, ticket links, interactions, materials, asset associations)
  // will FK-crash (500) instead of returning a clean 409, and there's no
  // safeguard against the API force-deleting a project that shouldn't be deleted.
  // Mirror TicketService.delete: route through deleteEntityWithValidation('project', ...)
  // (config already exists in @alga-psa/core), clean up child rows, and throw
  // ConflictError when blocking dependencies exist.
  async delete(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();

      await withTransaction(knex, async (trx) => {
        const result = await scopedTable(trx, context.tenant, this.tableName)
          .where({ [this.primaryKey]: id })
          .del();

        if (result === 0) {
          throw new NotFoundError('Project not found');
        }
      });

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
      const { knex } = await this.getKnex();
      
      return scopedTable<IProjectPhase>(knex, context.tenant, 'project_phases')
        .where({ project_id: projectId })
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
          status: data.status ?? 'planning',
          project_id: projectId,
          order_number: nextOrderNumber,
          wbs_code: newWbsCode,
          order_key: orderKey,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [phase] = await tenantDb(trx, context.tenant).table('project_phases')
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
  
        const [phase] = await scopedTable<IProjectPhase>(trx, context.tenant, 'project_phases')
          .where({ phase_id: phaseId })
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
      
      const result = await scopedTable(knex, context.tenant, 'project_phases')
        .where({ phase_id: phaseId })
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
      const db = tenantDb(knex, context.tenant);
      
      // Check if there are any phases for this project
      const phases = await db.table('project_phases')
        .where({ project_id: projectId })
        .select('phase_id');
        
      if (phases.length === 0) {
        // No phases means no tasks
        return [];
      }
      
      const query = db.table('project_tasks');
      db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      return await query
        .where({
          'project_phases.project_id': projectId
        })
        .select('project_tasks.*')
        .orderBy([
          { column: 'project_tasks.order_key', order: 'asc' },
          { column: 'project_tasks.wbs_code', order: 'asc' }
        ]) as unknown as IProjectTask[];
    }


  async createTask(phaseId: string, data: CreateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
      const { knex } = await this.getKnex();
      
      const result = await withTransaction(knex, async (trx) => {
        const db = tenantDb(trx, context.tenant);
        const phase = await db.table('project_phases')
          .where({ phase_id: phaseId })
          .first();
  
        if (!phase) {
          throw new NotFoundError('Phase not found');
        }
  
        const tasks = await db.table('project_tasks')
          .where({ phase_id: phaseId });
  
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
  
        const [task] = await db.table('project_tasks')
          .insert(taskData)
          .returning('*');

        const occurredAt = task.created_at instanceof Date ? task.created_at : new Date();
        const ctx = {
          tenantId: context.tenant,
          occurredAt,
          actor: { actorType: 'USER' as const, actorUserId: context.userId },
        };

        const statusInfo = await resolveProjectStatusInfo(trx, context.tenant, task.project_status_mapping_id);

        const workflowEvents: DeferredWorkflowEvent[] = [
          {
            eventType: 'PROJECT_TASK_CREATED',
            payload: buildProjectTaskCreatedPayload({
              projectId: phase.project_id,
              taskId: task.task_id,
              title: task.task_name,
              dueDate: task.due_date,
              status: statusInfo.status,
              createdByUserId: context.userId,
              createdAt: occurredAt,
            }),
          },
        ];

        if (task.assigned_to) {
          const assignedByName = await resolveUserName(trx, context.tenant, context.userId);
          workflowEvents.push({
            eventType: 'PROJECT_TASK_ASSIGNED',
            payload: buildProjectTaskAssignedPayload({
              projectId: phase.project_id,
              taskId: task.task_id,
              assignedToId: task.assigned_to,
              assignedToType: 'user',
              assignedByUserId: context.userId,
              assignedByName,
              assignedAt: occurredAt,
            }),
          });
        }

        return { task, ctx, workflowEvents };
      });

      for (const event of result.workflowEvents) {
        await publishWorkflowEvent({
          eventType: event.eventType,
          ctx: result.ctx,
          payload: event.payload,
        });
      }

      return result.task as IProjectTask;
    }


  async updateTask(taskId: string, data: InternalUpdateProjectTaskData, context: ServiceContext): Promise<IProjectTask> {
      const { knex } = await this.getKnex();
      
      const result = await withTransaction(knex, async (trx) => {
        const db = tenantDb(trx, context.tenant);
        const beforeTask = await db.table('project_tasks')
          .where({ task_id: taskId })
          .first();

        if (!beforeTask) {
          throw new NotFoundError('Project task not found');
        }

        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        const [task] = await db.table('project_tasks')
          .where({ task_id: taskId })
          .update(updateData)
          .returning('*');
  
        if (!task) {
          throw new NotFoundError('Project task not found');
        }

        const phase = await db.table('project_phases')
          .where({ phase_id: task.phase_id })
          .select('project_id')
          .first<{ project_id: string }>();

        const workflowEvents: DeferredWorkflowEvent[] = [];
        let ctx: {
          tenantId: string;
          occurredAt: Date;
          actor: { actorType: 'USER'; actorUserId: string };
        } | null = null;

        if (phase) {
          const occurredAt = task.updated_at instanceof Date ? task.updated_at : new Date();
          ctx = {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER' as const, actorUserId: context.userId },
          };

          if (beforeTask.assigned_to !== task.assigned_to && task.assigned_to) {
            const assignedByName = await resolveUserName(trx, context.tenant, context.userId);
            workflowEvents.push({
              eventType: 'PROJECT_TASK_ASSIGNED',
              payload: buildProjectTaskAssignedPayload({
                projectId: phase.project_id,
                taskId: task.task_id,
                assignedToId: task.assigned_to,
                assignedToType: 'user',
                assignedByUserId: context.userId,
                assignedByName,
                assignedAt: occurredAt,
              }),
            });
          }

          if (beforeTask.project_status_mapping_id !== task.project_status_mapping_id) {
            const [beforeStatus, afterStatus] = await Promise.all([
              resolveProjectStatusInfo(trx, context.tenant, beforeTask.project_status_mapping_id),
              resolveProjectStatusInfo(trx, context.tenant, task.project_status_mapping_id),
            ]);

            workflowEvents.push({
              eventType: 'PROJECT_TASK_STATUS_CHANGED',
              payload: buildProjectTaskStatusChangedPayload({
                projectId: phase.project_id,
                taskId: task.task_id,
                previousStatus: beforeStatus.status,
                newStatus: afterStatus.status,
                changedAt: occurredAt,
              }),
            });

            if (!beforeStatus.isClosed && afterStatus.isClosed) {
              workflowEvents.push({
                eventType: 'PROJECT_TASK_COMPLETED',
                payload: buildProjectTaskCompletedPayload({
                  projectId: phase.project_id,
                  taskId: task.task_id,
                  completedByUserId: context.userId,
                  completedAt: occurredAt,
                }),
              });
            }
          }
        }
  
        return { task, ctx, workflowEvents };
      });

      if (result.ctx) {
        for (const event of result.workflowEvents) {
          await publishWorkflowEvent({
            eventType: event.eventType,
            ctx: result.ctx,
            payload: event.payload,
          });
        }
      }

      return result.task as IProjectTask;
    }


  async deleteTask(taskId: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const result = await scopedTable(knex, context.tenant, 'project_tasks')
        .where({ task_id: taskId })
        .del();
  
      if (result === 0) {
        throw new NotFoundError('Project task not found');
      }
    }


  // Task checklist items
  async getTaskChecklistItems(taskId: string, context: ServiceContext): Promise<ITaskChecklistItem[]> {
      const { knex } = await this.getKnex();
      
      return scopedTable<ITaskChecklistItem>(knex, context.tenant, 'task_checklist_items')
        .where({ task_id: taskId })
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
  
        const [item] = await tenantDb(trx, context.tenant).table('task_checklist_items')
          .insert(itemData)
          .returning('*');
  
        return item;
      });
    }


  // Project ticket links
  async getProjectTicketLinks(projectId: string, context: ServiceContext): Promise<IProjectTicketLink[]> {
      const { knex } = await this.getKnex();
      
      const db = tenantDb(knex, context.tenant);
      const query = db.table('project_ticket_links');
      db.tenantJoin(query, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' });
      db.tenantJoin(query, 'clients', 'tickets.client_id', 'clients.client_id', { type: 'left' });
      return query
        .where({
          'project_ticket_links.project_id': projectId
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
  
      const [link] = await tenantDb(knex, context.tenant).table('project_ticket_links')
        .insert(linkData)
        .returning('*');
  
      return link;
    }


  // Search and export
  async search(searchData: ProjectSearchData, context: ServiceContext): Promise<IProject[]> {
      const { knex } = await this.getKnex();
      const tableName = this.tableName; // Capture tableName in scope
      
      const db = tenantDb(knex, context.tenant);
      const query = db.table(tableName);
  
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
      db.tenantJoin(query, 'clients', `${tableName}.client_id`, 'clients.client_id', { type: 'left' });
      query
        .select(`${tableName}.*`, 'clients.client_name')
        .orderBy(`${tableName}.project_name`)
        .limit(searchData.limit || 25);
  
      return await query as IProject[];
    }


  // Statistics
  async getStatistics(context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const tableName = this.tableName;
      const db = tenantDb(knex, context.tenant);
      
      const statsQuery = db.table(tableName);
      db.tenantJoin(statsQuery, 'statuses', `${tableName}.status`, 'statuses.status_id', { type: 'left' });
      const stats = await statsQuery
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
        .first() as any;
  
      // Get projects by status
      const projectsByStatusQuery = db.table(tableName);
      db.tenantJoin(projectsByStatusQuery, 'statuses', `${tableName}.status`, 'statuses.status_id', { type: 'left' });
      const projectsByStatus = await projectsByStatusQuery
        .groupBy('statuses.name')
        .select('statuses.name as status', knex.raw('COUNT(*) as count'));
  
      // Get projects by client
      const projectsByClientQuery = db.table(tableName);
      db.tenantJoin(projectsByClientQuery, 'clients', `${tableName}.client_id`, 'clients.client_id');
      const projectsByClient = await projectsByClientQuery
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
      let status = await this.buildProjectStatusQuery(knex, context)
        .where({ is_default: true })
        .first();
      
      // If no default status, get the first one by order
      if (!status) {
        status = await this.buildProjectStatusQuery(knex, context)
          .orderBy('order_number')
          .first();
      }
  
      if (!status) {
        throw new Error('No default project status found');
      }
  
      return status;
    }

  private buildProjectStatusQuery(knex: Knex, context: ServiceContext) {
    return scopedTable(knex, context.tenant, 'statuses')
      .andWhere((query) => {
        query.where('status_type', 'project').orWhere('item_type', 'project');
      });
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
    
    const status = await this.buildProjectStatusQuery(knex, context)
      .where({ name: dbStatusName })
      .first();

    if (!status) {
      throw new Error(`Invalid status: ${statusName}`);
    }

    return status.status_id;
  }


  private async setupDefaultStatusMappings(projectId: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const db = tenantDb(knex, context.tenant);
      const standardStatuses = await db.table('standard_statuses')
        .where({ item_type: 'project_task' })
        .orderBy('display_order');
  
      for (const status of standardStatuses) {
        await db.table('project_status_mappings').insert({
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
        scopedTable(knex, context.tenant, 'project_phases')
          .where({ project_id: projectId })
          .count('* as count')
          .first(),
        (() => {
          const db = tenantDb(knex, context.tenant);
          const query = db.table('project_tasks');
          db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
          db.tenantJoin(
            query,
            'project_status_mappings as project_status_mapping',
            'project_tasks.project_status_mapping_id',
            'project_status_mapping.project_status_mapping_id',
            { type: 'left' }
          );
          return query
          .where({
            'project_phases.project_id': projectId
          })
          .select([
            knex.raw('COUNT(*) as total_tasks'),
            knex.raw(`COUNT(CASE WHEN project_status_mapping.is_closed THEN 1 END) as completed_tasks`),
            knex.raw('SUM(project_tasks.estimated_hours) as total_estimated_hours'),
            knex.raw('SUM(project_tasks.actual_hours) as total_actual_hours')
          ])
          .leftJoin('standard_statuses', function joinStandardStatuses(this: Knex.JoinClause) {
            this.on('project_status_mapping.standard_status_id', '=', 'standard_statuses.standard_status_id');
          })
          .first();
        })()
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
      
      return scopedTable(knex, context.tenant, 'clients')
        .where({ client_id: clientId })
        .select('client_id', 'client_name', 'email', 'phone_no')
        .first();
    }


  private async getProjectContact(contactId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return scopedTable(knex, context.tenant, 'contacts')
        .where({ contact_name_id: contactId })
        .select('contact_name_id', 'full_name', 'email', 'phone_number')
        .first();
    }


  private async getProjectAssignedUser(userId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return scopedTable(knex, context.tenant, 'users')
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
    const tableName = this.tableName;
    const db = tenantDb(knex, context.tenant);
    const query = db.table(tableName);
    db.tenantJoin(query, 'clients', `${tableName}.client_id`, 'clients.client_id', { type: 'left' });
    db.tenantJoin(query, 'contacts', `${tableName}.contact_name_id`, 'contacts.contact_name_id', { type: 'left' });
    db.tenantJoin(query, 'users', `${tableName}.assigned_to`, 'users.user_id', { type: 'left' });
    query
      .select(
        `${tableName}.*`,
        'clients.client_name',
        'contacts.full_name as contact_name',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
      )
      .orderBy(`${tableName}.project_name`);

    // Apply filters
    if (filters.project_name) {
      query.where(`${tableName}.project_name`, 'ilike', `%${filters.project_name}%`);
    }
    if (filters.client_id) {
      query.where(`${tableName}.client_id`, filters.client_id);
    }
    if (filters.status) {
      query.where(`${tableName}.status`, filters.status);
    }
    if (filters.assigned_to) {
      query.where(`${tableName}.assigned_to`, filters.assigned_to);
    }
    if (filters.start_date_from) {
      query.where(`${tableName}.start_date`, '>=', filters.start_date_from);
    }
    if (filters.start_date_to) {
      query.where(`${tableName}.start_date`, '<=', filters.start_date_to);
    }
    if (filters.is_inactive !== undefined) {
      query.where(`${tableName}.is_inactive`, filters.is_inactive);
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

  async getProjectTaskStatusMappings(
    projectId: string,
    context: ServiceContext,
  ): Promise<IProjectStatusMapping[]> {
    const { knex } = await this.getKnex();

    const project = await this.getById(projectId, context);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const db = tenantDb(knex, context.tenant);
    const query = db.table<IProjectStatusMapping>('project_status_mappings as psm')
      .where({ 'psm.project_id': projectId });
    db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });

    query
      .leftJoin('standard_statuses as ss', function joinStandardStatuses(this: Knex.JoinClause) {
        this.on('psm.standard_status_id', '=', 'ss.standard_status_id');
      })
      .select(
        'psm.*',
        knex.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
        knex.raw('COALESCE(psm.custom_name, s.name, ss.name) as name'),
        knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
      );

    return query.orderBy('psm.display_order');
  }

  async getProjectTickets(projectId: string, pagination: any, context: ServiceContext): Promise<{data: any[], total: number}> {
    const { knex } = await this.getKnex();
    
    // Get tickets related to this project through project_ticket_links
    const db = tenantDb(knex, context.tenant);
    const baseQuery = db.table('project_ticket_links');
    db.tenantJoin(baseQuery, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' });
    db.tenantJoin(baseQuery, 'clients', 'tickets.client_id', 'clients.client_id', { type: 'left' });
    db.tenantJoin(baseQuery, 'users', 'tickets.assigned_to', 'users.user_id', { type: 'left' });
    baseQuery
      .where({
        'project_ticket_links.project_id': projectId
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
    
    const tasks = await scopedTable<IProjectTask>(knex, context.tenant, 'project_tasks')
      .where({
        phase_id: phaseId
      })
      .orderBy([
        { column: 'order_key', order: 'asc' },
        { column: 'wbs_code', order: 'asc' }
      ]);

    return tasks;
  }

  /**
   * Get task by ID
   */
  async getTaskById(taskId: string, context: ServiceContext): Promise<IProjectTask | null> {
    const { knex } = await this.getKnex();
    
    const task = await scopedTable<IProjectTask>(knex, context.tenant, 'project_tasks')
      .where({
        task_id: taskId
      })
      .first();

    return task || null;
  }


}

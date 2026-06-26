import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import type {
  IProjectTask,
  ITaskChecklistItem,
  IProjectTicketLink,
  IProjectTicketLinkWithDetails,
  IProjectTaskCardInfo,
  ITicketLinkedTask,
} from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import ProjectModel from './project';

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder<Row, any[]> {
  return tenantDb(conn, tenant).table<Row>(table) as Knex.QueryBuilder<Row, any[]>;
}

const ProjectTaskModel = {
  addTask: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, phaseId: string, taskData: Omit<IProjectTask, 'task_id' | 'phase_id' | 'created_at' | 'updated_at' | 'tenant' | 'wbs_code'> & { order_key?: string }): Promise<IProjectTask> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const phase = await ProjectModel.getPhaseById(knexOrTrx, tenant, phaseId);

      if (!phase) {
        throw new Error('Phase not found');
      }
  
      const newWbsCode = await ProjectModel.generateNextWbsCode(knexOrTrx, tenant, phase.wbs_code);
  
      // If no order_key provided, generate one at the end
      let orderKey = taskData.order_key;
      if (!orderKey) {
        const { generateKeyBetween } = await import('fractional-indexing');
        const lastTask = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant)
          .where({ 
            phase_id: phaseId, 
            project_status_mapping_id: taskData.project_status_mapping_id
          })
          .orderBy('order_key', 'desc')
          .first();
        orderKey = generateKeyBetween(lastTask?.order_key || null, null);
      }
  
      const [newTask] = await tenantScopedTable<IProjectTask>(knexOrTrx, 'project_tasks', tenant)
        .insert({
          ...taskData,
          task_id: uuidv4(),
          assigned_to: taskData.assigned_to === '' || taskData.assigned_to === null ? undefined : taskData.assigned_to,
          service_id: taskData.service_id === '' ? null : (taskData.service_id || null),
          phase_id: phaseId,
          project_status_mapping_id: taskData.project_status_mapping_id,
          wbs_code: newWbsCode,
          order_key: orderKey,
          task_type_key: taskData.task_type_key || 'task',
          tenant,
        })
        .returning('*');
  
      return newTask;
    } catch (error) {
      console.error('Error adding task to phase:', error);
      throw error;
    }
  },

  updateTask: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string, taskData: Partial<IProjectTask>): Promise<IProjectTask> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      // Filter out invalid columns and transform data
      const validColumns = [
        'task_name',
        'description',
        'description_rich_text',
        'assigned_to',
        'estimated_hours',
        'due_date',
        'actual_hours',
        'wbs_code',
        'project_status_mapping_id',
        'order_key',
        'priority_id',
        'task_type_key',
        'service_id'
      ];
      
      const finalTaskData: Partial<IProjectTask> = {
        updated_at: new Date()
      };
      
      for (const key of Object.keys(taskData)) {
        if (validColumns.includes(key)) {
          const typedKey = key as keyof IProjectTask;
          const value = taskData[typedKey];
          
          switch(typedKey) {
            case 'assigned_to':
              finalTaskData[typedKey] = value === '' ? null : value as string | null;
              break;
            case 'priority_id':
              finalTaskData[typedKey] = value === '' ? null : value as string | null;
              break;
            case 'task_name':
            case 'description':
            case 'description_rich_text':
            case 'wbs_code':
            case 'project_status_mapping_id':
            case 'order_key':
            case 'task_type_key':
              if (typeof value === 'string') {
                finalTaskData[typedKey] = value;
              }
              break;
            case 'estimated_hours':
            case 'actual_hours':
              if (typeof value === 'number') {
                finalTaskData[typedKey] = value;
              }
              break;
            case 'due_date':
              // Convert string to Date if needed
              if (typeof value === 'string') {
                finalTaskData[typedKey] = new Date(value);
              } else if (value instanceof Date || value === null) {
                finalTaskData[typedKey] = value as Date | null;
              }
              break;
            case 'service_id':
              finalTaskData[typedKey] = (value === '' || value === undefined) ? null : value as string | null;
              break;
          }
        }
      }

      const [updatedTask] = await tenantScopedTable<IProjectTask>(knexOrTrx, 'project_tasks', tenant)
        .where('task_id', taskId)
        .update(finalTaskData)
        .returning('*');

      return updatedTask;
    } catch (error) {
      console.error('Error updating task:', error);
      throw error;
    }
  },

  updateTaskStatus: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string, projectStatusMappingId: string): Promise<IProjectTask> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      // Get current task to preserve phase information
      const task = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant)
        .where('task_id', taskId)
        .first() as IProjectTask | undefined;
      
      if (!task) {
        throw new Error('Task not found');
      }

      // Generate new WBS code for the task in its current phase
      const parentWbs = task.wbs_code.split('.').slice(0, -1).join('.');
      const newWbsCode = await ProjectModel.generateNextWbsCode(knexOrTrx, tenant, parentWbs);

      const [updatedTask] = await tenantScopedTable<IProjectTask>(knexOrTrx, 'project_tasks', tenant)
        .where('task_id', taskId)
        .update({
          project_status_mapping_id: projectStatusMappingId,
          wbs_code: newWbsCode,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');
      return updatedTask;
    } catch (error) {
      console.error('Error updating task status:', error);
      throw error;
    }
  },

  getTaskById: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<IProjectTask | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const task = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant)
        .where('task_id', taskId)
        .first() as IProjectTask | undefined;
      return task || null;
    } catch (error) {
      console.error('Error getting task by ID:', error);
      throw error;
    }
  },

  deleteTask: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        // Delete task dependencies (both as predecessor and successor)
        await tenantScopedTable(trx, 'project_task_dependencies', tenant)
          .where(function() {
            this.where('predecessor_task_id', taskId)
              .orWhere('successor_task_id', taskId);
          })
          .del();

        // Delete task comment reactions before comments (CitusDB doesn't support ON DELETE CASCADE)
        const taskCommentIds = await tenantScopedTable(trx, 'project_task_comments', tenant)
          .where('task_id', taskId)
          .pluck('task_comment_id');
        if (taskCommentIds.length > 0) {
          await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
            .whereIn('task_comment_id', taskCommentIds)
            .del();
        }

        // Delete task comments
        await tenantScopedTable(trx, 'project_task_comments', tenant)
          .where('task_id', taskId)
          .del();

        await tenantScopedTable(trx, 'task_resources', tenant)
          .where('task_id', taskId)
          .del();
        await tenantScopedTable(trx, 'task_checklist_items', tenant)
          .where('task_id', taskId)
          .del();

        await tenantScopedTable(trx, 'project_tasks', tenant)
          .where('task_id', taskId)
          .del();
          
        if (!isTransaction) {
          await trx.commit();
        }
      } catch (error) {
        if (!isTransaction) {
          await trx.rollback();
        }
        throw error;
      }
    } catch (error) {
      console.error('Error deleting task:', error);
      throw error;
    }
  },

  getTasks: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<IProjectTaskCardInfo[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const tasksQuery = tenantScopedTable(knexOrTrx, 'project_tasks', tenant);
      db.tenantJoin(tasksQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      db.tenantJoin(tasksQuery, 'users', 'project_tasks.assigned_to', 'users.user_id', { type: 'left' });
      const tasks = await tasksQuery
        .where('project_phases.project_id', projectId)
        .andWhere('project_tasks.phase_id', knexOrTrx.ref('project_phases.phase_id')) // Ensure phase matches
        .select(
          'project_tasks.*',
          'project_phases.project_id',
          knexOrTrx.raw('CONCAT(users.first_name, \' \', users.last_name) as assigned_to_name')
        )
        .orderBy('project_tasks.wbs_code') as IProjectTaskCardInfo[];
      return tasks.sort((a, b) => {
        const aNumbers = a.wbs_code.split('.').map((n: string): number => parseInt(n));
        const bNumbers = b.wbs_code.split('.').map((n: string): number => parseInt(n));
        
        // Compare each part numerically
        for (let i = 0; i < Math.max(aNumbers.length, bNumbers.length); i++) {
          const aNum = aNumbers[i] || 0;
          const bNum = bNumbers[i] || 0;
          if (aNum !== bNum) {
            return aNum - bNum;
          }
        }
        return 0;
      });
    } catch (error) {
      console.error('Error getting project tasks:', error);
      throw error;
    }
  },

  reorderTasksInStatus: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tasks: { taskId: string, newWbsCode: string }[]): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        const taskRecords = await tenantScopedTable(trx, 'project_tasks', tenant)
          .whereIn('task_id', tasks.map((t): string => t.taskId))
          .select('task_id', 'phase_id') as Array<{ task_id: string; phase_id: string }>;

        if (taskRecords.length !== tasks.length) {
          throw new Error('Some tasks not found');
        }

        const phaseId = taskRecords[0].phase_id;
        if (!taskRecords.every(t => t.phase_id === phaseId)) {
          throw new Error('All tasks must be in the same phase');
        }

        await Promise.all(tasks.map(({taskId, newWbsCode}): Promise<number> =>
          tenantScopedTable(trx, 'project_tasks', tenant)
            .where('task_id', taskId)
            .update({
              wbs_code: newWbsCode,
              updated_at: trx.fn.now()
            })
        ));
        
        if (!isTransaction) {
          await trx.commit();
        }
      } catch (error) {
        if (!isTransaction) {
          await trx.rollback();
        }
        throw error;
      }
    } catch (error) {
      console.error('Error reordering tasks:', error);
      throw error;
    }
  },

  // Task Checklist Methods
  addChecklistItem: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string, itemData: Omit<ITaskChecklistItem, 'checklist_item_id' | 'task_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<ITaskChecklistItem> => {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const [newItem] = await tenantScopedTable<ITaskChecklistItem>(knexOrTrx, 'task_checklist_items', tenant)
      .insert({
        ...itemData,
        task_id: taskId,
        checklist_item_id: uuidv4(),
        tenant
      })
      .returning('*');
    return newItem;
  },

  updateChecklistItem: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, checklistItemId: string, itemData: Partial<ITaskChecklistItem>): Promise<ITaskChecklistItem> => {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const [updatedItem] = await tenantScopedTable<ITaskChecklistItem>(knexOrTrx, 'task_checklist_items', tenant)
      .where({ checklist_item_id: checklistItemId })
      .update({
        ...itemData,
        updated_at: knexOrTrx.fn.now()
      })
      .returning('*');
    return updatedItem;
  },

  deleteChecklistItem: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, checklistItemId: string): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    await tenantScopedTable(knexOrTrx, 'task_checklist_items', tenant)
      .where({
        checklist_item_id: checklistItemId
      })
      .delete();
  },

  getChecklistItems: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<ITaskChecklistItem[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const items = await tenantScopedTable(knexOrTrx, 'task_checklist_items', tenant)
      .where({
        task_id: taskId
      })
      .orderBy('order_number', 'asc');
    return items;
  },

  deleteChecklistItems: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      await tenantScopedTable(knexOrTrx, 'task_checklist_items', tenant)
        .where('task_id', taskId)
        .delete();
    } catch (error) {
      console.error('Error deleting checklist items:', error);
      throw error;
    }
  },

  getAllTaskChecklistItems: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<{ [taskId: string]: ITaskChecklistItem[] }> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const itemsQuery = tenantScopedTable(knexOrTrx, 'task_checklist_items', tenant);
      db.tenantJoin(itemsQuery, 'project_tasks', 'task_checklist_items.task_id', 'project_tasks.task_id');
      db.tenantJoin(itemsQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      const items = await itemsQuery
        .where('project_phases.project_id', projectId)
        .orderBy('task_checklist_items.order_number', 'asc')
        .select('task_checklist_items.*') as ITaskChecklistItem[];

      return items.reduce((acc: { [taskId: string]: ITaskChecklistItem[] }, item) => {
        if (!acc[item.task_id]) {
          acc[item.task_id] = [];
        }
        acc[item.task_id].push(item);
        return acc;
      }, {});
    } catch (error) {
      console.error('Error getting all task checklist items:', error);
      throw error;
    }
  },

  // Task Resources Methods
  addTaskResource: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string, userId: string, role?: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      const task = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant)
        .where('task_id', taskId)
        .first();

      if (!task) {
        throw new Error('Task not found');
      }

      const existingResource = await tenantScopedTable(knexOrTrx, 'task_resources', tenant)
        .where({ task_id: taskId, additional_user_id: userId })
        .first();

      if (existingResource) {
        throw new Error(`Resource already exists for user ${userId}`);
      }

      // assigned_to is guaranteed non-null: either the task already has one,
      // or we fall back to the additional user being added.
      const assignedTo: string = (task.assigned_to as string | null) || userId;

      await tenantScopedTable(knexOrTrx, 'task_resources', tenant).insert({
        tenant,
        task_id: taskId,
        assigned_to: assignedTo,
        additional_user_id: userId,
        role: role || null
      });
    } catch (error) {
      console.error('Error adding task resource:', error);
      throw error;
    }
  },

  removeTaskResource: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, assignmentId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      await tenantScopedTable(knexOrTrx, 'task_resources', tenant)
        .where('assignment_id', assignmentId)
        .del();
    } catch (error) {
      console.error('Error removing task resource:', error);
      throw error;
    }
  },

  getTaskResources: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<Array<{
    assignment_id: string;
    task_id: string;
    assigned_to: string | null;
    additional_user_id: string;
    role: string | null;
    first_name: string;
    last_name: string;
    tenant: string;
  }>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const resourcesQuery = tenantScopedTable(knexOrTrx, 'task_resources', tenant)
        .select(
          'task_resources.*',
          'users.first_name',
          'users.last_name'
        );
      db.tenantJoin(resourcesQuery, 'users', 'task_resources.additional_user_id', 'users.user_id', { type: 'left' });
      const resources = await resourcesQuery
        .where('task_id', taskId);
      return resources;
    } catch (error) {
      console.error('Error getting task resources:', error);
      throw error;
    }
  },

  // Task Ticket Links Methods
  addTaskTicketLink: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, projectId: string, taskId: string | null, ticketId: string, phaseId: string): Promise<IProjectTicketLink> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      const existingLink = await tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant)
        .where({
          project_id: projectId,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: ticketId
        })
        .first();

      if (existingLink) {
        throw new Error('This ticket is already linked to this task');
      }

      const [newLink] = await tenantScopedTable<IProjectTicketLink>(knexOrTrx, 'project_ticket_links', tenant)
        .insert({
          link_id: uuidv4(),
          project_id: projectId,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: ticketId,
          tenant,
          created_at: knexOrTrx.fn.now()
        })
        .returning('*');
      return newLink;
    } catch (error) {
      console.error('Error adding ticket link:', error);
      throw error;
    }
  },

  getTaskTicketLinks: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<IProjectTicketLinkWithDetails[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const linksQuery = tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant);
      db.tenantJoin(linksQuery, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' });
      const links = await linksQuery
        .where('task_id', taskId)
        .select(
          'project_ticket_links.*',
          'tickets.ticket_number',
          'tickets.title',
          'statuses.name as status_name',
          'statuses.is_closed'
        ) as IProjectTicketLinkWithDetails[];
      return links;
    } catch (error) {
      console.error('Error getting task ticket links:', error);
      throw error;
    }
  },

  getTasksByPhase: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, phaseId: string): Promise<IProjectTask[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      // Get phase to find its WBS code
      const phase = await tenantScopedTable(knexOrTrx, 'project_phases', tenant)
        .where({ phase_id: phaseId })
        .first();
        
      if (!phase) {
        return [];
      }
      
      // Get all tasks that belong to this phase (based on WBS code)
      const tasks = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant)
        .where('wbs_code', 'like', `${phase.wbs_code}.%`)
        .orderBy('order_key');
        
      return tasks;
    } catch (error) {
      console.error('Error getting tasks by phase:', error);
      throw error;
    }
  },

  getTaskTicketLinksForTasks: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskIds: string[]): Promise<IProjectTicketLinkWithDetails[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      if (taskIds.length === 0) {
        return [];
      }
      
      const db = tenantDb(knexOrTrx, tenant);
      const linksQuery = tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant);
      db.tenantJoin(linksQuery, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' });
      const links = await linksQuery
        .whereIn('task_id', taskIds)
        .select(
          'project_ticket_links.*',
          'tickets.ticket_number',
          'tickets.title',
          'statuses.name as status_name',
          'statuses.is_closed'
        ) as IProjectTicketLinkWithDetails[];
      return links;
    } catch (error) {
      console.error('Error getting task ticket links for tasks:', error);
      throw error;
    }
  },

  getTaskResourcesForTasks: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, taskIds: string[]): Promise<any[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      if (taskIds.length === 0) {
        return [];
      }
      
      const resources = await tenantScopedTable(knexOrTrx, 'task_resources', tenant)
        .whereIn('task_id', taskIds);
        
      return resources;
    } catch (error) {
      console.error('Error getting task resources for tasks:', error);
      throw error;
    }
  },

  deleteTaskTicketLink: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, linkId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      await tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant)
        .where('link_id', linkId)
        .del();
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      throw error;
    }
  },

  deleteTaskTicketLinksByTicketId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, ticketId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      await tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant)
        .where('ticket_id', ticketId)
        .del();
    } catch (error) {
      console.error('Error deleting ticket links by ticket_id:', error);
      throw error;
    }
  },

  updateTaskTicketLink: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, linkId: string, updateData: { project_id: string; phase_id: string }): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      await tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant)
        .where('link_id', linkId)
        .update(updateData);
    } catch (error) {
      console.error('Error updating task ticket link:', error);
      throw error;
    }
  },

  getAllTaskTicketLinks: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<{ [taskId: string]: IProjectTicketLinkWithDetails[] }> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const linksQuery = tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant);
      db.tenantJoin(linksQuery, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' });
      const links = await linksQuery
        .where('project_ticket_links.project_id', projectId)
        .select(
          'project_ticket_links.*',
          'tickets.ticket_number',
          'tickets.title',
          'statuses.name as status_name',
          'statuses.is_closed'
        ) as IProjectTicketLinkWithDetails[];

      return links.reduce((acc: { [taskId: string]: IProjectTicketLinkWithDetails[] }, link) => {
        if (link.task_id) {
          if (!acc[link.task_id]) {
            acc[link.task_id] = [];
          }
          acc[link.task_id].push(link);
        }
        return acc;
      }, {});
    } catch (error) {
      console.error('Error getting all task ticket links:', error);
      throw error;
    }
  },

  getLinkedTasksForTicket: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, ticketId: string): Promise<ITicketLinkedTask[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const linksQuery = tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant);
      db.tenantJoin(linksQuery, 'project_tasks', 'project_ticket_links.task_id', 'project_tasks.task_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'projects', 'project_ticket_links.project_id', 'projects.project_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'project_status_mappings as psm', 'project_tasks.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
      db.tenantJoin(linksQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
      const links = await linksQuery
        .where('project_ticket_links.ticket_id', ticketId)
        .whereNotNull('project_ticket_links.task_id')
        .leftJoin('standard_statuses as ss', function() {
          this.on('psm.standard_status_id', 'ss.standard_status_id');
        })
        .select(
          'project_ticket_links.link_id',
          'project_tasks.task_id',
          'project_tasks.task_name',
          'projects.project_id',
          'projects.project_name',
          'project_phases.phase_id',
          'project_phases.phase_name',
          knexOrTrx.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
          knexOrTrx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
        );
      return links;
    } catch (error) {
      console.error('Error getting linked tasks for ticket:', error);
      throw error;
    }
  },

  getAllTaskResources: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<{ [taskId: string]: any[] }> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      const db = tenantDb(knexOrTrx, tenant);
      const resourcesQuery = tenantScopedTable(knexOrTrx, 'task_resources', tenant);
      db.tenantJoin(resourcesQuery, 'project_tasks', 'task_resources.task_id', 'project_tasks.task_id');
      db.tenantJoin(resourcesQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      db.tenantJoin(resourcesQuery, 'users', 'task_resources.additional_user_id', 'users.user_id', { type: 'left' });
      const resources = await resourcesQuery
        .where('project_phases.project_id', projectId)
        .select(
          'task_resources.*',
          'users.first_name',
          'users.last_name'
        ) as any[];

      return resources.reduce((acc: { [taskId: string]: any[] }, resource) => {
        if (!acc[resource.task_id]) {
          acc[resource.task_id] = [];
        }
        acc[resource.task_id].push(resource);
        return acc;
      }, {});
    } catch (error) {
      console.error('Error getting all task resources:', error);
      throw error;
    }
  }
};

export default ProjectTaskModel;

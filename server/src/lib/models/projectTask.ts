import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { 
  IProjectTask, 
  ITaskChecklistItem, 
  IProjectTicketLink, 
  IProjectTicketLinkWithDetails, 
  IProjectTaskCardInfo 
} from '@/interfaces/project.interfaces';
import ProjectModel from './project'

const ProjectTaskModel = {
  addTask: async (phaseId: string, taskData: Omit<IProjectTask, 'task_id' | 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProjectTask> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const phase = await ProjectModel.getPhaseById(phaseId);

      if (!phase) {
        throw new Error('Phase not found');
      }
  
      const newWbsCode = await ProjectModel.generateNextWbsCode(phase.wbs_code);
  
      const [newTask] = await db<IProjectTask>('project_tasks')
        .insert({
          ...taskData,
          task_id: uuidv4(),
          assigned_to: taskData.assigned_to === '' ? null : taskData.assigned_to,
          phase_id: phaseId,
          project_status_mapping_id: taskData.project_status_mapping_id,
          wbs_code: newWbsCode,
          tenant: tenant!,
        })
        .returning('*');
  
      return newTask;
    } catch (error) {
      console.error('Error adding task to phase:', error);
      throw error;
    }
  },

  updateTask: async (taskId: string, taskData: Partial<IProjectTask>): Promise<IProjectTask> => {
    try {
      const {knex: db} = await createTenantKnex();

      const finalTaskData = {
        ...taskData,
        assigned_to: taskData.assigned_to === '' ? null : taskData.assigned_to,
        updated_at: db.fn.now()
      };

      const [updatedTask] = await db<IProjectTask>('project_tasks')
        .where('task_id', taskId)
        .update(finalTaskData)
        .returning('*');

      return updatedTask;
    } catch (error) {
      console.error('Error updating task:', error);
      throw error;
    }
  },

  updateTaskStatus: async (taskId: string, projectStatusMappingId: string): Promise<IProjectTask> => {
    try {
      const {knex: db} = await createTenantKnex();
      
      // Get current task to preserve phase information
      const task = await db<IProjectTask>('project_tasks')
        .where('task_id', taskId)
        .first();
      
      if (!task) {
        throw new Error('Task not found');
      }

      // Generate new WBS code for the task in its current phase
      const parentWbs = task.wbs_code.split('.').slice(0, -1).join('.');
      const newWbsCode = await ProjectModel.generateNextWbsCode(parentWbs);

      const [updatedTask] = await db<IProjectTask>('project_tasks')
        .where('task_id', taskId)
        .update({ 
          project_status_mapping_id: projectStatusMappingId,
          wbs_code: newWbsCode,
          updated_at: db.fn.now()
        })
        .returning('*');
      return updatedTask;
    } catch (error) {
      console.error('Error updating task status:', error);
      throw error;
    }
  },

  getTaskById: async (taskId: string): Promise<IProjectTask | null> => {
    try {
      const {knex: db} = await createTenantKnex();
      const task = await db<IProjectTask>('project_tasks')
        .where('task_id', taskId)
        .first();
      return task || null;
    } catch (error) {
      console.error('Error getting task by ID:', error);
      throw error;
    }
  },

  deleteTask: async (taskId: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db.transaction(async (trx: Knex.Transaction) => {
        await trx('task_resources').where('task_id', taskId).del();
        await trx('task_checklist_items').where('task_id', taskId).del();
        await trx<IProjectTask>('project_tasks').where('task_id', taskId).del();
      });
    } catch (error) {
      console.error('Error deleting task:', error);
      throw error;
    }
  },

  getTasks: async (projectId: string): Promise<IProjectTaskCardInfo[]> => {
    try {
      const {knex: db} = await createTenantKnex();
      const tasks = await db<IProjectTask>('project_tasks')
        .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
        .leftJoin('users', 'project_tasks.assigned_to', 'users.user_id')
        .where('project_phases.project_id', projectId)
        .select(
          'project_tasks.*',
          'project_phases.project_id',
          db.raw('CONCAT(users.first_name, \' \', users.last_name) as assigned_to_name')
        )
        .orderBy('project_tasks.wbs_code');
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

  reorderTasksInStatus: async (tasks: { taskId: string, newWbsCode: string }[]): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db.transaction(async (trx: Knex.Transaction) => {
        const taskRecords = await trx('project_tasks')
          .whereIn('task_id', tasks.map((t): string => t.taskId))
          .select('task_id', 'phase_id');

        if (taskRecords.length !== tasks.length) {
          throw new Error('Some tasks not found');
        }

        const phaseId = taskRecords[0].phase_id;
        if (!taskRecords.every(t => t.phase_id === phaseId)) {
          throw new Error('All tasks must be in the same phase');
        }

        await Promise.all(tasks.map(({taskId, newWbsCode}): Promise<number> =>
          trx('project_tasks')
            .where('task_id', taskId)
            .update({
              wbs_code: newWbsCode,
              updated_at: trx.fn.now()
            })
        ));
      });
    } catch (error) {
      console.error('Error reordering tasks:', error);
      throw error;
    }
  },

  // Task Checklist Methods
  addChecklistItem: async (taskId: string, itemData: Omit<ITaskChecklistItem, 'checklist_item_id' | 'task_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<ITaskChecklistItem> => {
    const {knex: db, tenant} = await createTenantKnex();
    const [newItem] = await db('task_checklist_items')
      .insert({
        ...itemData,
        task_id: taskId,
        checklist_item_id: uuidv4(),
        tenant
      })
      .returning('*');
    return newItem;
  },

  updateChecklistItem: async (checklistItemId: string, itemData: Partial<ITaskChecklistItem>): Promise<ITaskChecklistItem> => {
    const {knex: db} = await createTenantKnex();
    const [updatedItem] = await db('task_checklist_items')
      .where({ checklist_item_id: checklistItemId })
      .update({
        ...itemData,
        updated_at: db.fn.now()
      })
      .returning('*');
    return updatedItem;
  },

  deleteChecklistItem: async (checklistItemId: string): Promise<void> => {
    const {knex: db} = await createTenantKnex();
    await db('task_checklist_items')
      .where({ checklist_item_id: checklistItemId })
      .delete();
  },

  getChecklistItems: async (taskId: string): Promise<ITaskChecklistItem[]> => {
    const {knex: db} = await createTenantKnex();
    const items = await db('task_checklist_items')
      .where({ task_id: taskId })
      .orderBy('order_number', 'asc');
    return items;
  },

  deleteChecklistItems: async (taskId: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db('task_checklist_items')
        .where('task_id', taskId)
        .delete();
    } catch (error) {
      console.error('Error deleting checklist items:', error);
      throw error;
    }
  },

  getAllTaskChecklistItems: async (projectId: string): Promise<{ [taskId: string]: ITaskChecklistItem[] }> => {
    try {
      const {knex: db} = await createTenantKnex();
      const items = await db('task_checklist_items')
        .join('project_tasks', 'task_checklist_items.task_id', 'project_tasks.task_id')
        .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
        .where('project_phases.project_id', projectId)
        .orderBy('task_checklist_items.order_number', 'asc')
        .select('task_checklist_items.*');

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
  addTaskResource: async (taskId: string, userId: string, role?: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      
      const task = await db('project_tasks')
        .where('task_id', taskId)
        .first();
      
      if (!task) {
        throw new Error('Task not found');
      }

      await db('task_resources').insert({
        tenant,
        task_id: taskId,
        assigned_to: task.assigned_to,
        additional_user_id: userId,
        role: role || null
      });
    } catch (error) {
      console.error('Error adding task resource:', error);
      throw error;
    }
  },

  removeTaskResource: async (assignmentId: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db('task_resources')
        .where('assignment_id', assignmentId)
        .del();
    } catch (error) {
      console.error('Error removing task resource:', error);
      throw error;
    }
  },

  getTaskResources: async (taskId: string): Promise<Array<{
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
      const {knex: db} = await createTenantKnex();
      const resources = await db('task_resources')
        .select(
          'task_resources.*',
          'users.first_name',
          'users.last_name'
        )
        .leftJoin('users', 'task_resources.additional_user_id', 'users.user_id')
        .where('task_id', taskId);
      return resources;
    } catch (error) {
      console.error('Error getting task resources:', error);
      throw error;
    }
  },

  // Task Ticket Links Methods
  addTaskTicketLink: async (projectId: string, taskId: string | null, ticketId: string, phaseId: string): Promise<IProjectTicketLink> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();

      const existingLink = await db<IProjectTicketLink>('project_ticket_links')
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

      const [newLink] = await db<IProjectTicketLink>('project_ticket_links')
        .insert({
          link_id: uuidv4(),
          project_id: projectId,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: ticketId,
          tenant: tenant!,
          created_at: db.fn.now()
        })
        .returning('*');
      return newLink;
    } catch (error) {
      console.error('Error adding ticket link:', error);
      throw error;
    }
  },

  getTaskTicketLinks: async (taskId: string): Promise<IProjectTicketLinkWithDetails[]> => {
    try {
      const {knex: db} = await createTenantKnex();
      const links = await db<IProjectTicketLink>('project_ticket_links')
        .where('task_id', taskId)
        .leftJoin('tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id')
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .select(
          'project_ticket_links.*',
          'tickets.ticket_number',
          'tickets.title',
          'statuses.name as status_name',
          'statuses.is_closed'
        );
      return links;
    } catch (error) {
      console.error('Error getting task ticket links:', error);
      throw error;
    }
  },

  deleteTaskTicketLink: async (linkId: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db<IProjectTicketLink>('project_ticket_links')
        .where('link_id', linkId)
        .del();
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      throw error;
    }
  },

  updateTaskTicketLink: async (linkId: string, updateData: { project_id: string; phase_id: string }): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db('project_ticket_links')
        .where('link_id', linkId)
        .update(updateData);
    } catch (error) {
      console.error('Error updating task ticket link:', error);
      throw error;
    }
  },

  getAllTaskTicketLinks: async (projectId: string): Promise<{ [taskId: string]: IProjectTicketLinkWithDetails[] }> => {
    try {
      const {knex: db} = await createTenantKnex();
      const links = await db('project_ticket_links')
        .where('project_ticket_links.project_id', projectId)
        .leftJoin('tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id')
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .select(
          'project_ticket_links.*',
          'tickets.ticket_number',
          'tickets.title',
          'statuses.name as status_name',
          'statuses.is_closed'
        );

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
  }
};

export default ProjectTaskModel;

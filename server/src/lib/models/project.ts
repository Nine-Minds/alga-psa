// server/src/lib/models/project.ts
import { v4 as uuidv4 } from 'uuid';
import { IProject, IProjectPhase, IProjectTask, IProjectStatusMapping } from 'server/src/interfaces/project.interfaces';
import { IStatus, IStandardStatus, ItemType } from 'server/src/interfaces/status.interface'
import { Knex } from 'knex';
import { getCurrentTenantId } from 'server/src/lib/db';
import { deleteEntityTags, deleteEntitiesTags } from '../utils/tagCleanup';

const ProjectModel = {
  updatePhase: async (knexOrTrx: Knex | Knex.Transaction, phaseId: string, phaseData: Partial<IProjectPhase>): Promise<IProjectPhase> => {
    try {
      const tenant = await getCurrentTenantId();
      const [updatedPhase] = await knexOrTrx<IProjectPhase>('project_phases')
        .where('phase_id', phaseId)
        .andWhere('tenant', tenant)
        .update({
          ...phaseData,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');
      return updatedPhase;
    } catch (error) {
      console.error('Error updating project phase:', error);
      throw error;
    }
  },

  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeInactive: boolean = false): Promise<IProject[]> => {
    try {
      const tenant = await getCurrentTenantId();
      let query = knexOrTrx<IProject>('projects')
        .where('projects.tenant', tenant)
        .select(
          'projects.*', 
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        )
        .leftJoin('clients', function() {
          this.on('projects.client_id', 'clients.client_id')
              .andOn('projects.tenant', 'clients.tenant')
        })
        .leftJoin('users', function() {
          this.on('projects.assigned_to', 'users.user_id')
             .andOn('projects.tenant', 'users.tenant')
        })
        .leftJoin('contacts', function() {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
             .andOn('projects.tenant', 'contacts.tenant')
        })
        .leftJoin('statuses as s', function() {
          this.on('projects.status', 's.status_id')
             .andOn('projects.tenant', 's.tenant')
        });
      
      if (!includeInactive) {
        query = query.where('projects.is_inactive', false);
      }
      
      const projects = await query
        .orderBy('projects.created_at', 'desc')
        .orderBy('projects.project_number', 'desc');
      return projects;
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  },

  getById: async (knexOrTrx: Knex | Knex.Transaction, projectId: string): Promise<IProject | null> => {
    try {
      const tenant = await getCurrentTenantId();
      const project = await knexOrTrx<IProject>('projects')
        .where('projects.tenant', tenant)
        .select(
          'projects.*', 
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        )
        .leftJoin('clients', function() {
          this.on('projects.client_id', 'clients.client_id')
              .andOn('projects.tenant', 'clients.tenant')
        })
        .leftJoin('users', function() {
          this.on('projects.assigned_to', 'users.user_id')
             .andOn('projects.tenant', 'users.tenant')
        })
        .leftJoin('contacts', function() {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
             .andOn('projects.tenant', 'contacts.tenant')
        })
        .leftJoin('statuses as s', function() {
          this.on('projects.status', 's.status_id')
             .andOn('projects.tenant', 's.tenant')
        })
        .where('projects.project_id', projectId)
        .first();

      return project || null;
    } catch (error) {
      console.error('Error getting project by ID:', error);
      throw error;
    }
  },

  getStatusesByType: async (knexOrTrx: Knex | Knex.Transaction, statusType: ItemType): Promise<IStatus[]> => {
    try {
      const tenant = await getCurrentTenantId();
      const statuses = await knexOrTrx<IStatus>('statuses')
        .where('status_type', statusType)
        .andWhere('tenant', tenant)
        .orderBy('order_number');
      return statuses;
    } catch (error) {
      console.error('Error getting statuses by type:', error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProject> => {
    try {
      const tenant = await getCurrentTenantId();
      // Remove derived fields before insert
      const { status_name, is_closed, client_portal_config, ...insertData } = projectData as any;

      // Build insert data, serializing JSONB fields
      const finalInsertData: Record<string, unknown> = {
        ...insertData,
        project_id: uuidv4(),
        is_inactive: false,
        tenant: tenant,
        assigned_to: insertData.assigned_to || null,
        contact_name_id: insertData.contact_name_id || null,
        status: insertData.status || '',
        budgeted_hours: insertData.budgeted_hours || null,
        project_number: insertData.project_number
      };

      // Only include client_portal_config if it was provided
      if (client_portal_config !== undefined) {
        finalInsertData.client_portal_config = JSON.stringify(client_portal_config);
      }

      const [newProject] = await knexOrTrx<IProject>('projects')
        .insert(finalInsertData)
        .returning('*');

      // Fetch the full project details including status info
      const projectWithStatus = await knexOrTrx<IProject>('projects')
        .select(
          'projects.*',
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        )
        .leftJoin('clients', function() {
          this.on('projects.client_id', 'clients.client_id')
              .andOn('projects.tenant', 'clients.tenant')
        })
        .leftJoin('users', function() {
          this.on('projects.assigned_to', 'users.user_id')
             .andOn('projects.tenant', 'users.tenant')
        })
        .leftJoin('contacts', function() {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
             .andOn('projects.tenant', 'contacts.tenant')
        })
        .leftJoin('statuses as s', function() {
          this.on('projects.status', 's.status_id')
             .andOn('projects.tenant', 's.tenant')
        })
        .where('projects.project_id', newProject.project_id)
        .first();

      return projectWithStatus || newProject;
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, projectId: string, projectData: Partial<IProject> & Record<string, any>): Promise<IProject> => {
    try {
      const tenant = await getCurrentTenantId();
      // Remove derived and joined fields before update
      const {
        status_name,
        is_closed,
        client_name,
        assigned_to_first_name,
        assigned_to_last_name,
        contact_name,
        tenant: _tenant, // Remove tenant from update data
        client_portal_config, // Handle JSONB serialization separately
        ...updateData
      } = projectData;

      // Build final update object, serializing JSONB fields
      const finalUpdateData: Record<string, unknown> = {
        ...updateData,
        updated_at: knexOrTrx.fn.now()
      };

      // Only include client_portal_config if it was provided
      if (client_portal_config !== undefined) {
        finalUpdateData.client_portal_config = JSON.stringify(client_portal_config);
      }

      const [updatedProject] = await knexOrTrx<IProject>('projects')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
        .update(finalUpdateData)
        .returning('*');

      // Fetch the full project details including status info
      const projectWithStatus = await knexOrTrx<IProject>('projects')
        .select(
          'projects.*',
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        )
        .leftJoin('clients', function() {
          this.on('projects.client_id', 'clients.client_id')
              .andOn('projects.tenant', 'clients.tenant')
        })
        .leftJoin('users', function() {
          this.on('projects.assigned_to', 'users.user_id')
             .andOn('projects.tenant', 'users.tenant')
        })
        .leftJoin('contacts', function() {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
             .andOn('projects.tenant', 'contacts.tenant')
        })
        .leftJoin('statuses as s', function() {
          this.on('s.status_id', '=', 'projects.status')
             .andOn('s.tenant', '=', 'projects.tenant')
        })
        .where('projects.project_id', projectId)
        .first();
      return projectWithStatus || updatedProject;
    } catch (error) {
      console.error('Error updating project:', error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, projectId: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        // First, get all phases for this project
        const phases = await trx('project_phases')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
          .select('phase_id');
        
        const phaseIds = phases.map((phase): string => phase.phase_id);

        // Delete checklist items for all tasks in all phases
        if (phaseIds.length > 0) {
          await trx('task_checklist_items')
            .whereIn('task_id',
              trx('project_tasks')
                .select('task_id')
                .whereIn('phase_id', phaseIds)
                .andWhere('tenant', tenant)
            )
            .andWhere('tenant', tenant)
            .del();
        }

        // Get all task IDs before deleting tasks
        let taskIds: string[] = [];
        if (phaseIds.length > 0) {
          const tasks = await trx('project_tasks')
            .whereIn('phase_id', phaseIds)
            .andWhere('tenant', tenant)
            .select('task_id');
          taskIds = tasks.map(t => t.task_id);
        }

        // Delete tags for all project tasks
        if (taskIds.length > 0) {
          await deleteEntitiesTags(trx, taskIds, 'project_task');
        }

        // Delete all tasks in all phases
        if (phaseIds.length > 0) {
          await trx('project_tasks')
            .whereIn('phase_id', phaseIds)
            .andWhere('tenant', tenant)
            .del();
        }

        // Delete project ticket links
        await trx('project_ticket_links')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
          .del();

        // Delete all phases
        await trx('project_phases')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
          .del();

        // Delete project status mappings
        await trx('project_status_mappings')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
          .del();
        
        // Delete project tags
        await deleteEntityTags(trx, projectId, 'project');

        // Clear project_id on interactions
        await trx('interactions')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
          .update({ project_id: null });

        // Finally, delete the project
        await trx('projects')
          .where('project_id', projectId)
          .andWhere('tenant', tenant)
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
      console.error('Error deleting project:', error);
      throw error;
    }
  },

  getStandardStatusesByType: async (knexOrTrx: Knex | Knex.Transaction, itemType: ItemType): Promise<IStandardStatus[]> => {
    try {
      const tenant = await getCurrentTenantId();
      const standardStatuses = await knexOrTrx<IStandardStatus>('standard_statuses')
        .where('item_type', itemType)
        .andWhere('tenant', tenant)
        .orderBy('display_order');
      return standardStatuses;
    } catch (error) {
      console.error('Error getting standard statuses by type:', error);
      throw error;
    }
  },

  addProjectStatusMapping: async (knexOrTrx: Knex | Knex.Transaction, projectId: string, mappingData: Omit<IProjectStatusMapping, 'project_id' | 'project_status_mapping_id' | 'tenant'>): Promise<IProjectStatusMapping> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const [newMapping] = await knexOrTrx<IProjectStatusMapping>('project_status_mappings')
        .insert({
          ...mappingData,
          project_id: projectId,
          project_status_mapping_id: uuidv4(),
          tenant: tenant
        })
        .returning('*');
      return newMapping;
    } catch (error) {
      console.error('Error adding project status mapping:', error);
      throw error;
    }
  },

  getProjectStatusMappings: async (knexOrTrx: Knex | Knex.Transaction, projectId: string): Promise<IProjectStatusMapping[]> => {
    try {
      const tenant = await getCurrentTenantId();
      const mappings = await knexOrTrx<IProjectStatusMapping>('project_status_mappings')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
        .orderBy('display_order');
      return mappings;
    } catch (error) {
      console.error('Error getting project status mappings:', error);
      throw error;
    }
  },

  getStandardStatus: async (knexOrTrx: Knex | Knex.Transaction, standardStatusId: string): Promise<IStandardStatus | null> => {
    try {
      const tenant = await getCurrentTenantId();
      const standardStatus = await knexOrTrx<IStandardStatus>('standard_statuses')
        .where('standard_status_id', standardStatusId)
        .andWhere('tenant', tenant)
        .first();
      return standardStatus || null;
    } catch (error) {
      console.error('Error getting standard status:', error);
      throw error;
    }
  },

  getCustomStatus: async (knexOrTrx: Knex | Knex.Transaction, statusId: string): Promise<IStatus | null> => {
    try {
      const tenant = await getCurrentTenantId();
      const customStatus = await knexOrTrx<IStatus>('statuses')
        .where('status_id', statusId)
        .andWhere('tenant', tenant)
        .first();
      return customStatus || null;
    } catch (error) {
      console.error('Error getting custom status:', error);
      throw error;
    }
  },

  getProjectTaskStatuses: async (knexOrTrx: Knex | Knex.Transaction, projectId: string): Promise<(IStatus | IStandardStatus)[]> => {
    try {
      const mappings = await ProjectModel.getProjectStatusMappings(knexOrTrx, projectId);
      const statuses = await Promise.all(mappings.map(async (mapping: IProjectStatusMapping): Promise<IStatus | IStandardStatus | null> => {
        if (mapping.is_standard && mapping.standard_status_id) {
          const standardStatus = await ProjectModel.getStandardStatus(knexOrTrx, mapping.standard_status_id);
          return standardStatus ? {
            ...standardStatus,
            project_status_mapping_id: mapping.project_status_mapping_id,
            custom_name: mapping.custom_name,
            display_order: mapping.display_order,
            is_visible: mapping.is_visible,
            is_standard: true
          } as IStandardStatus : null;
        } else if (mapping.status_id) {
          const customStatus = await ProjectModel.getCustomStatus(knexOrTrx, mapping.status_id);
          return customStatus ? {
            ...customStatus,
            project_status_mapping_id: mapping.project_status_mapping_id,
            custom_name: mapping.custom_name,
            display_order: mapping.display_order,
            is_visible: mapping.is_visible,
            is_standard: false
          } as IStatus : null;
        } else {
          console.error('Invalid project status mapping: missing both standard_status_id and status_id');
          return null;
        }
      }));
      return statuses.filter((status): status is IStatus | IStandardStatus => status !== null);
    } catch (error) {
      console.error('Error getting project statuses:', error);
      throw error;
    }
  },

  addStatusToProject: async (knexOrTrx: Knex | Knex.Transaction, projectId: string, statusData: Omit<IStatus, 'status_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IStatus> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        const [newStatus] = await trx<IStatus>('statuses')
          .insert({
            ...statusData,
            status_id: uuidv4(),
            tenant: tenant
          })
          .returning('*');

        await trx<IProjectStatusMapping>('project_status_mappings')
          .insert({
            project_id: projectId,
            status_id: newStatus.status_id,
            is_standard: false,
            custom_name: null,
            display_order: 0,
            is_visible: true,
            project_status_mapping_id: uuidv4(),
            tenant: tenant
          });

        if (!isTransaction) {
          await trx.commit();
        }
        
        return newStatus;
      } catch (error) {
        if (!isTransaction) {
          await trx.rollback();
        }
        throw error;
      }
    } catch (error) {
      console.error('Error adding status to project:', error);
      throw error;
    }
  },

  updateProjectStatus: async (knexOrTrx: Knex | Knex.Transaction, statusId: string, statusData: Partial<IStatus>, mappingData: Partial<IProjectStatusMapping>): Promise<IStatus> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        const [updatedStatus] = await trx<IStatus>('statuses')
          .where('status_id', statusId)
          .andWhere('tenant', tenant)
          .update({
            ...statusData
          })
          .returning('*');

        if (mappingData) {
          await trx<IProjectStatusMapping>('project_status_mappings')
            .where('status_id', statusId)
            .andWhere('tenant', tenant)
            .update(mappingData);
        }

        if (!isTransaction) {
          await trx.commit();
        }
        
        return updatedStatus;
      } catch (error) {
        if (!isTransaction) {
          await trx.rollback();
        }
        throw error;
      }
    } catch (error) {
      console.error('Error updating project status:', error);
      throw error;
    }
  },

  deleteProjectStatus: async (knexOrTrx: Knex | Knex.Transaction, statusId: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        // First, check if the status is being used by any tasks
        const tasksUsingStatus = await trx<IProjectTask>('project_tasks')
          .where('project_status_mapping_id', statusId)
          .first();

        if (tasksUsingStatus) {
          throw new Error('Cannot delete status: it is being used by one or more tasks');
        }

        await trx<IProjectStatusMapping>('project_status_mappings')
          .where('status_id', statusId)
          .andWhere('tenant', tenant)
          .del();

        await trx<IStatus>('statuses')
          .where('status_id', statusId)
          .andWhere('tenant', tenant)
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
      console.error('Error deleting project status:', error);
      throw error;
    }
  },

  getPhases: async (knexOrTrx: Knex | Knex.Transaction, projectId: string): Promise<IProjectPhase[]> => {
    try {
      const tenant = await getCurrentTenantId();
      const phases = await knexOrTrx<IProjectPhase>('project_phases')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
        .orderBy('wbs_code');
      // Sort phases by numeric values in WBS code
      return phases.sort((a, b) => {
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
      console.error('Error getting project phases:', error);
      throw error;
    }
  },

  getPhaseById: async (knexOrTrx: Knex | Knex.Transaction, phaseId: string): Promise<IProjectPhase | null> => {
    try {
      const tenant = await getCurrentTenantId();
      const phase = await knexOrTrx<IProjectPhase>('project_phases')
        .where('phase_id', phaseId)
        .andWhere('tenant', tenant)
        .first();
      return phase || null;
    } catch (error) {
      console.error('Error getting project phase by ID:', error);
      throw error;
    }
  },  

  updateStructure: async (knexOrTrx: Knex | Knex.Transaction, projectId: string, updates: { phases: Partial<IProjectPhase>[]; tasks: Partial<IProjectTask>[] }): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        for (const phase of updates.phases) {
          if (!phase.phase_id) {
            throw new Error('Phase ID is required for update');
          }
          // Remove wbs_code from updates to prevent override
          const { wbs_code, ...phaseUpdate } = phase;
          await trx('project_phases')
            .where({ project_id: projectId, phase_id: phase.phase_id })
            .andWhere('tenant', tenant)
            .update({
              ...phaseUpdate,
              updated_at: trx.fn.now()
            });
        }
        for (const task of updates.tasks) {
          if (!task.task_id) {
            throw new Error('Task ID is required for update');
          }
          // Remove wbs_code from updates to prevent override
          const { wbs_code, ...taskUpdate } = task;
          await trx('project_tasks')
            .where({ task_id: task.task_id })
            .andWhere('tenant', tenant)
            .update({
              ...taskUpdate,
              updated_at: trx.fn.now()
            });
        }
        
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
      console.error('Error updating project structure:', error);
      throw error;
    }
  },

  generateNextWbsCode: async (knexOrTrx: Knex | Knex.Transaction, parentWbsCode: string): Promise<string> => {
    try {
      const tenant = await getCurrentTenantId();
      
      // If no parent code, get next project number
      if (!parentWbsCode) {
        const projects = await knexOrTrx('projects')
          .whereNot('wbs_code', '')
          .andWhere('tenant', tenant)
          .select('wbs_code');
        
        if (projects.length === 0) return '1';
        
        const numbers = projects.map((p): number => parseInt(p.wbs_code))
                .filter((n: number): boolean => !isNaN(n))
                .sort((a: number, b: number): number => b - a);
        
        return String(numbers[0] + 1);
      }

      // Split parent code into parts
      const parts = parentWbsCode.split('.');
      
      // For project level (single number), get next phase number
      if (parts.length === 1) {
        const phases = await knexOrTrx('project_phases')
          .where('wbs_code', 'like', `${parentWbsCode}.%`)
          .andWhere('tenant', tenant)
          .select('wbs_code');

        if (phases.length === 0) return `${parentWbsCode}.1`;

        const numbers = phases.map((phase): number => {
          const phaseParts = phase.wbs_code.split('.');
          return parseInt(phaseParts[1]);
        })
        .filter((n: number): boolean => !isNaN(n))
        .sort((a: number, b: number): number => b - a);

        return `${parentWbsCode}.${numbers[0] + 1}`;
      }

      // For phase level (two numbers), get next task number
      if (parts.length === 2) {
        const tasks = await knexOrTrx('project_tasks')
          .where('wbs_code', 'like', `${parentWbsCode}.%`)
          .andWhere('tenant', tenant)
          .select('wbs_code');

        if (tasks.length === 0) return `${parentWbsCode}.1`;

        const numbers = tasks.map((task): number => {
          const taskParts = task.wbs_code.split('.');
          return parseInt(taskParts[2]);
        })
        .filter((n: number): boolean => !isNaN(n))
        .sort((a: number, b: number): number => b - a);

        return `${parentWbsCode}.${numbers[0] + 1}`;
      }

      throw new Error('Invalid WBS code format');
    } catch (error) {
      console.error('Error generating next WBS code:', error);
      throw error;
    }
  },

  addPhase: async (knexOrTrx: Knex | Knex.Transaction, phaseData: Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProjectPhase> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      
      // Generate order_key for the new phase
      const { generateKeyBetween } = await import('fractional-indexing');
      const lastPhase = await knexOrTrx('project_phases')
        .where({ project_id: phaseData.project_id, tenant })
        .orderBy('order_key', 'desc')
        .first();
      const orderKey = generateKeyBetween(lastPhase?.order_key || null, null);
      
      const [newPhase] = await knexOrTrx<IProjectPhase>('project_phases')
        .insert({
          ...phaseData,
          phase_id: uuidv4(),
          order_key: orderKey,
          tenant: tenant,
          created_at: knexOrTrx.fn.now(),
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');

      return newPhase;
    } catch (error) {
      console.error('Error adding project phase:', error);
      throw error;
    }
  },

  deletePhase: async (knexOrTrx: Knex | Knex.Transaction, phaseId: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant found');
      }
      const isTransaction = (knexOrTrx as any).isTransaction || false;
      const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();
      
      try {
        // First, delete all checklist items for tasks in this phase
        await trx('task_checklist_items')        
          .whereIn('task_id', 
            trx('project_tasks')
              .select('task_id')
              .where('phase_id', phaseId)
          )
          .andWhere('tenant', tenant)
          .del();

        // Delete all tasks in the phase
        await trx('project_tasks')
          .where('phase_id', phaseId)
          .andWhere('tenant', tenant)
          .del();

        // Finally, delete the phase itself
        await trx('project_phases')
          .where('phase_id', phaseId)
          .andWhere('tenant', tenant)
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
      console.error('Error deleting phase:', error);
      throw error;
    }
  },
  
  getProjectStatusMapping: async (knexOrTrx: Knex | Knex.Transaction, mappingId: string): Promise<IProjectStatusMapping | null> => {
    try {
      const tenant = await getCurrentTenantId();
      const mapping = await knexOrTrx<IProjectStatusMapping>('project_status_mappings')
        .where('project_status_mapping_id', mappingId)
        .andWhere('tenant', tenant)
        .first();
      return mapping || null;
    } catch (error) {
      console.error('Error getting project status mapping:', error);
      throw error;
    }
  }
};

export default ProjectModel;

/**
 * @alga-psa/projects - Project Model
 *
 * Data access layer for project entities.
 * Migrated from server/src/lib/models/project.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 */

import type { Knex } from 'knex';
import type { IProject, IProjectPhase, IProjectStatusMapping, IProjectTask, IStatus, IStandardStatus, ItemType } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

/** Status enriched with mapping metadata as returned by getProjectTaskStatuses. */
export type ProjectTaskStatus = (IStatus | IStandardStatus) & Pick<IProjectStatusMapping, 'project_status_mapping_id' | 'phase_id' | 'custom_name' | 'display_order' | 'is_visible'> & { is_standard: boolean };

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder<Row, any[]> {
  return tenantDb(conn, tenant).table<Row>(table) as Knex.QueryBuilder<Row, any[]>;
}

/**
 * Project model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const ProjectModel = {
  /**
   * Get all projects for a tenant.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    includeInactive: boolean = false
  ): Promise<IProject[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting all projects');
    }

    try {
      const db = tenantDb(knexOrTrx, tenant);
      let query = tenantScopedTable(knexOrTrx, 'projects', tenant)
        .select(
          'projects.*',
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        );
      db.tenantJoin(query, 'clients', 'projects.client_id', 'clients.client_id', { type: 'left' });
      db.tenantJoin(query, 'users', 'projects.assigned_to', 'users.user_id', { type: 'left' });
      db.tenantJoin(query, 'contacts', 'projects.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
      db.tenantJoin(query, 'statuses as s', 'projects.status', 's.status_id', { type: 'left' });

      if (!includeInactive) {
        query = query.where('projects.is_inactive', false);
      }

      const projects = await query
        .orderBy('projects.created_at', 'desc')
        .orderBy('projects.project_number', 'desc') as IProject[];

      return projects;
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  },

  /**
   * Get a single project by ID.
   */
  getById: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string
  ): Promise<IProject | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project');
    }

    try {
      const db = tenantDb(knexOrTrx, tenant);
      const query = tenantScopedTable(knexOrTrx, 'projects', tenant)
        .select(
          'projects.*',
          'clients.client_name as client_name',
          'users.first_name as assigned_to_first_name',
          'users.last_name as assigned_to_last_name',
          'contacts.full_name as contact_name',
          's.name as status_name',
          's.is_closed'
        );
      db.tenantJoin(query, 'clients', 'projects.client_id', 'clients.client_id', { type: 'left' });
      db.tenantJoin(query, 'users', 'projects.assigned_to', 'users.user_id', { type: 'left' });
      db.tenantJoin(query, 'contacts', 'projects.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
      db.tenantJoin(query, 'statuses as s', 'projects.status', 's.status_id', { type: 'left' });
      const project = await query
        .where('projects.project_id', projectId)
        .first() as IProject | undefined;

      return project || null;
    } catch (error) {
      console.error('Error getting project by ID:', error);
      throw error;
    }
  },

  /**
   * Create a new project.
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant'>
  ): Promise<IProject> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating project');
    }

    try {
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

      const [newProject] = await tenantScopedTable<IProject>(knexOrTrx, 'projects', tenant)
        .insert(finalInsertData)
        .returning('*');

      // Fetch the full project details including status info
      const projectWithStatus = await ProjectModel.getById(knexOrTrx, tenant, newProject.project_id);
      return projectWithStatus || newProject;
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  },

  /**
   * Update an existing project.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    projectData: Partial<IProject> & Record<string, any>
  ): Promise<IProject> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating project');
    }

    try {
      // Remove derived and joined fields before update
      const {
        status_name,
        is_closed,
        client_name,
        assigned_to_first_name,
        assigned_to_last_name,
        contact_name,
        tenant: _tenant,
        client_portal_config,
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

      const [updatedProject] = await tenantScopedTable<IProject>(knexOrTrx, 'projects', tenant)
        .where('project_id', projectId)
        .update(finalUpdateData)
        .returning('*');

      if (!updatedProject) {
        throw new Error(`Project ${projectId} not found in tenant ${tenant}`);
      }

      // Fetch the full project details including status info
      const projectWithStatus = await ProjectModel.getById(knexOrTrx, tenant, projectId);
      return projectWithStatus || updatedProject;
    } catch (error) {
      console.error('Error updating project:', error);
      throw error;
    }
  },

  /**
   * Delete a project.
   * Note: This performs cascading deletes of phases, tasks, and related entities.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting project');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();

    try {
      // First, get all phases for this project
      const phases = await tenantScopedTable(trx, 'project_phases', tenant)
        .where('project_id', projectId)
        .select('phase_id') as Array<{ phase_id: string }>;

      const phaseIds = phases.map((phase): string => phase.phase_id);

      // Build subquery for task IDs in this project's phases
      const taskIdsSubquery = tenantScopedTable(trx, 'project_tasks', tenant)
        .select('task_id')
        .whereIn('phase_id', phaseIds);

      // Check for time entries linked to tasks in this project
      if (phaseIds.length > 0) {
        const timeEntriesCount = await tenantScopedTable(trx, 'time_entries', tenant)
          .whereIn('work_item_id', taskIdsSubquery)
          .andWhere('work_item_type', 'project_task')
          .count('* as count')
          .first();

        if (timeEntriesCount && Number(timeEntriesCount.count) > 0) {
          throw new Error(
            `Cannot delete project: ${timeEntriesCount.count} time ${Number(timeEntriesCount.count) === 1 ? 'entry exists' : 'entries exist'} for tasks in this project.`
          );
        }
      }

      // Delete task dependencies (both predecessor and successor references)
      if (phaseIds.length > 0) {
        await tenantScopedTable(trx, 'project_task_dependencies', tenant)
          .where(function() {
            this.whereIn('predecessor_task_id', taskIdsSubquery)
              .orWhereIn('successor_task_id', taskIdsSubquery);
          })
          .del();
      }

      // Delete task comment reactions before comments (CitusDB doesn't support ON DELETE CASCADE)
      if (phaseIds.length > 0) {
        const commentIdsSubquery = tenantScopedTable(trx, 'project_task_comments', tenant)
          .select('task_comment_id')
          .whereIn('task_id', taskIdsSubquery);
        await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
          .whereIn('task_comment_id', commentIdsSubquery)
          .del();
      }

      // Delete task comments
      if (phaseIds.length > 0) {
        await tenantScopedTable(trx, 'project_task_comments', tenant)
          .whereIn('task_id', taskIdsSubquery)
          .del();
      }

      // Delete task resources (additional assignees)
      if (phaseIds.length > 0) {
        await tenantScopedTable(trx, 'task_resources', tenant)
          .whereIn('task_id', taskIdsSubquery)
          .del();
      }

      // Delete checklist items for all tasks in all phases
      if (phaseIds.length > 0) {
        await tenantScopedTable(trx, 'task_checklist_items', tenant)
          .whereIn('task_id', taskIdsSubquery)
          .del();
      }

      // Delete all tasks in all phases
      if (phaseIds.length > 0) {
        await tenantScopedTable(trx, 'project_tasks', tenant)
          .whereIn('phase_id', phaseIds)
          .del();
      }

      // Delete project ticket links
      await tenantScopedTable(trx, 'project_ticket_links', tenant)
        .where('project_id', projectId)
        .del();

      // Delete all phases
      await tenantScopedTable(trx, 'project_phases', tenant)
        .where('project_id', projectId)
        .del();

      // Delete project status mappings
      await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where('project_id', projectId)
        .del();

      // Finally, delete the project
      const deleted = await tenantScopedTable(trx, 'projects', tenant)
        .where('project_id', projectId)
        .del();

      if (deleted === 0) {
        throw new Error(`Project ${projectId} not found in tenant ${tenant}`);
      }

      if (!isTransaction) {
        await trx.commit();
      }
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      console.error('Error deleting project:', error);
      throw error;
    }
  },

  /**
   * Get all phases for a project.
   */
  getPhases: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string
  ): Promise<IProjectPhase[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project phases');
    }

    try {
      const phases = await tenantScopedTable(knexOrTrx, 'project_phases', tenant)
        .where('project_id', projectId)
        .orderBy('wbs_code') as IProjectPhase[];

      // Sort phases by numeric values in WBS code
      return phases.sort((a, b) => {
        const aNumbers = a.wbs_code.split('.').map((n: string): number => parseInt(n));
        const bNumbers = b.wbs_code.split('.').map((n: string): number => parseInt(n));

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

  /**
   * Add a new phase to a project.
   */
  addPhase: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    phaseData: Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>
  ): Promise<IProjectPhase> => {
    if (!tenant) {
      throw new Error('Tenant context is required for adding project phase');
    }

    try {
      // Generate order_key for the new phase
      const { generateKeyBetween } = await import('fractional-indexing');
      const lastPhase = await tenantScopedTable(knexOrTrx, 'project_phases', tenant)
        .where({ project_id: phaseData.project_id })
        .orderBy('order_key', 'desc')
        .first();
      const orderKey = generateKeyBetween(lastPhase?.order_key || null, null);

      const [newPhase] = await tenantScopedTable<IProjectPhase>(knexOrTrx, 'project_phases', tenant)
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

  /**
   * Update a project phase.
   */
  updatePhase: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    phaseId: string,
    phaseData: Partial<IProjectPhase>
  ): Promise<IProjectPhase> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating project phase');
    }

    try {
      const [updatedPhase] = await tenantScopedTable<IProjectPhase>(knexOrTrx, 'project_phases', tenant)
        .where('phase_id', phaseId)
        .update({
          ...phaseData,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');

      if (!updatedPhase) {
        throw new Error(`Phase ${phaseId} not found in tenant ${tenant}`);
      }

      return updatedPhase;
    } catch (error) {
      console.error('Error updating project phase:', error);
      throw error;
    }
  },

  /**
   * Delete a project phase.
   */
  deletePhase: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    phaseId: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting project phase');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();

    try {
      // Build subquery for task IDs in this phase
      const taskIdsSubquery = tenantScopedTable(trx, 'project_tasks', tenant)
        .select('task_id')
        .where('phase_id', phaseId);

      // Check for time entries linked to tasks in this phase
      const timeEntriesCount = await tenantScopedTable(trx, 'time_entries', tenant)
        .whereIn('work_item_id', taskIdsSubquery)
        .andWhere('work_item_type', 'project_task')
        .count('* as count')
        .first();

      if (timeEntriesCount && Number(timeEntriesCount.count) > 0) {
        throw new Error(
          `Cannot delete phase: ${timeEntriesCount.count} time ${Number(timeEntriesCount.count) === 1 ? 'entry exists' : 'entries exist'} for tasks in this phase.`
        );
      }

      // Delete task dependencies (both predecessor and successor references)
      await tenantScopedTable(trx, 'project_task_dependencies', tenant)
        .where(function() {
          this.whereIn('predecessor_task_id', taskIdsSubquery)
            .orWhereIn('successor_task_id', taskIdsSubquery);
        })
        .del();

      // Delete task comment reactions before comments (CitusDB doesn't support ON DELETE CASCADE)
      const commentIdsSubquery = tenantScopedTable(trx, 'project_task_comments', tenant)
        .select('task_comment_id')
        .whereIn('task_id', taskIdsSubquery);
      await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
        .whereIn('task_comment_id', commentIdsSubquery)
        .del();

      // Delete task comments
      await tenantScopedTable(trx, 'project_task_comments', tenant)
        .whereIn('task_id', taskIdsSubquery)
        .del();

      // Delete task resources (additional assignees)
      await tenantScopedTable(trx, 'task_resources', tenant)
        .whereIn('task_id', taskIdsSubquery)
        .del();

      // Delete all checklist items for tasks in this phase
      await tenantScopedTable(trx, 'task_checklist_items', tenant)
        .whereIn('task_id', taskIdsSubquery)
        .del();

      // Delete all tasks in the phase
      await tenantScopedTable(trx, 'project_tasks', tenant)
        .where('phase_id', phaseId)
        .del();

      // Finally, delete the phase itself
      const deleted = await tenantScopedTable(trx, 'project_phases', tenant)
        .where('phase_id', phaseId)
        .del();

      if (deleted === 0) {
        throw new Error(`Phase ${phaseId} not found in tenant ${tenant}`);
      }

      if (!isTransaction) {
        await trx.commit();
      }
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      console.error('Error deleting phase:', error);
      throw error;
    }
  },

  /**
   * Get project status mappings.
   */
  getProjectStatusMappings: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    phaseId?: string | null
  ): Promise<IProjectStatusMapping[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project status mappings');
    }

    try {
      const query = tenantScopedTable(knexOrTrx, 'project_status_mappings', tenant)
        .where('project_id', projectId) as Knex.QueryBuilder;

      if (phaseId) {
        query.andWhere('phase_id', phaseId);
      } else {
        query.whereNull('phase_id');
      }

      const mappings = await query.orderBy('display_order');
      return mappings;
    } catch (error) {
      console.error('Error getting project status mappings:', error);
      throw error;
    }
  },

  /**
   * Get the effective project status mappings for a phase.
   * Returns phase-specific mappings when present, otherwise project defaults.
   */
  getEffectiveStatusMappings: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    phaseId?: string | null
  ): Promise<IProjectStatusMapping[]> => {
    if (!phaseId) {
      return ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId);
    }

    const phaseMappings = await ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId, phaseId);
    if (phaseMappings.length > 0) {
      return phaseMappings;
    }

    return ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId);
  },

  /**
   * Get projects by client ID.
   */
  getByClientId: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<IProject[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting projects by client');
    }

    const projects = await tenantScopedTable(knexOrTrx, 'projects', tenant)
      .where({
        client_id: clientId
      })
      .select('*') as IProject[];

    return projects;
  },

  getStatusesByType: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, statusType: ItemType): Promise<IStatus[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting statuses by type');
    }

    try {
      const statuses = await tenantScopedTable(knexOrTrx, 'statuses', tenant)
        .where('status_type', statusType)
        .orderBy('order_number') as IStatus[];
      return statuses;
    } catch (error) {
      console.error('Error getting statuses by type:', error);
      throw error;
    }
  },

  getStandardStatusesByType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemType: ItemType
  ): Promise<IStandardStatus[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting standard statuses by type');
    }

    try {
      const standardStatuses = await tenantScopedTable<IStandardStatus>(knexOrTrx, 'standard_statuses', tenant)
        .where('item_type', itemType)
        .orderBy('display_order');
      return standardStatuses;
    } catch (error) {
      console.error('Error getting standard statuses by type:', error);
      throw error;
    }
  },

  addProjectStatusMapping: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    mappingData: Omit<IProjectStatusMapping, 'project_id' | 'project_status_mapping_id' | 'tenant'>
  ): Promise<IProjectStatusMapping> => {
    if (!tenant) {
      throw new Error('Tenant context is required for adding project status mapping');
    }

    try {
      const [newMapping] = await tenantScopedTable<IProjectStatusMapping>(knexOrTrx, 'project_status_mappings', tenant)
        .insert({
          ...mappingData,
          project_id: projectId,
          project_status_mapping_id: uuidv4(),
          tenant: tenant,
        })
        .returning('*');
      return newMapping;
    } catch (error) {
      console.error('Error adding project status mapping:', error);
      throw error;
    }
  },

  getStandardStatus: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, standardStatusId: string): Promise<IStandardStatus | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting standard status');
    }

    try {
      const standardStatus = await tenantScopedTable<IStandardStatus>(knexOrTrx, 'standard_statuses', tenant)
        .where('standard_status_id', standardStatusId)
        .first();
      return standardStatus || null;
    } catch (error) {
      console.error('Error getting standard status:', error);
      throw error;
    }
  },

  getCustomStatus: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, statusId: string): Promise<IStatus | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting custom status');
    }

    try {
      const customStatus = await tenantScopedTable(knexOrTrx, 'statuses', tenant)
        .where('status_id', statusId)
        .first() as IStatus | undefined;
      return customStatus || null;
    } catch (error) {
      console.error('Error getting custom status:', error);
      throw error;
    }
  },

  getProjectTaskStatuses: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    phaseId?: string | null
  ): Promise<ProjectTaskStatus[]> => {
    try {
      const mappings = await ProjectModel.getEffectiveStatusMappings(knexOrTrx, tenant, projectId, phaseId);
      if (!mappings || mappings.length === 0) return [];

      // Batch-fetch all standard and custom statuses in 2 queries instead of 1 per mapping
      const standardIds = mappings
        .filter(m => m.is_standard && m.standard_status_id)
        .map(m => m.standard_status_id!);
      const customIds = mappings
        .filter(m => !m.is_standard && m.status_id)
        .map(m => m.status_id!);

      const [standardStatusRows, customStatusRows] = await Promise.all([
        standardIds.length > 0
          ? tenantScopedTable<IStandardStatus>(knexOrTrx, 'standard_statuses', tenant).whereIn('standard_status_id', standardIds)
          : [],
        customIds.length > 0
          ? tenantScopedTable(knexOrTrx, 'statuses', tenant).whereIn('status_id', customIds)
          : []
      ]);

      const standardMap = new Map((standardStatusRows as IStandardStatus[]).map(s => [s.standard_status_id, s]));
      const customMap = new Map((customStatusRows as IStatus[]).map(s => [s.status_id, s]));

      const statuses = mappings.map((mapping: IProjectStatusMapping): ProjectTaskStatus | null => {
        if (mapping.is_standard && mapping.standard_status_id) {
          const standardStatus = standardMap.get(mapping.standard_status_id);
          return standardStatus
            ? ({
                ...standardStatus,
                project_status_mapping_id: mapping.project_status_mapping_id,
                phase_id: mapping.phase_id,
                custom_name: mapping.custom_name,
                display_order: mapping.display_order,
                is_visible: mapping.is_visible,
                is_standard: true,
              } as ProjectTaskStatus)
            : null;
        } else if (mapping.status_id) {
          const customStatus = customMap.get(mapping.status_id);
          return customStatus
            ? ({
                ...customStatus,
                project_status_mapping_id: mapping.project_status_mapping_id,
                phase_id: mapping.phase_id,
                custom_name: mapping.custom_name,
                display_order: mapping.display_order,
                is_visible: mapping.is_visible,
                is_standard: false,
              } as ProjectTaskStatus)
            : null;
        } else {
          console.error('Invalid project status mapping: missing both standard_status_id and status_id');
          return null;
        }
      });
      return statuses.filter((status): status is ProjectTaskStatus => status !== null);
    } catch (error) {
      console.error('Error getting project statuses:', error);
      throw error;
    }
  },

  addStatusToProject: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    statusData: Omit<IStatus, 'status_id' | 'created_at' | 'updated_at' | 'tenant'>
  ): Promise<IStatus> => {
    if (!tenant) {
      throw new Error('Tenant context is required for adding status to project');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await knexOrTrx.transaction();

    try {
      const [newStatus] = await tenantScopedTable<IStatus>(trx, 'statuses', tenant)
        .insert({
          ...statusData,
          status_id: uuidv4(),
          tenant: tenant,
        })
        .returning('*');

      await tenantScopedTable<IProjectStatusMapping>(trx, 'project_status_mappings', tenant).insert({
        project_id: projectId,
        status_id: newStatus.status_id,
        is_standard: false,
        custom_name: null,
        display_order: 0,
        is_visible: true,
        project_status_mapping_id: uuidv4(),
        tenant: tenant,
      });

      if (!isTransaction) {
        await trx.commit();
      }

      return newStatus;
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      console.error('Error adding status to project:', error);
      throw error;
    }
  },

  updateProjectStatus: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    statusId: string,
    statusData: Partial<IStatus>,
    mappingData: Partial<IProjectStatusMapping>
  ): Promise<IStatus> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating project status');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await knexOrTrx.transaction();

    try {
      const [updatedStatus] = await tenantScopedTable<IStatus>(trx, 'statuses', tenant).where('status_id', statusId).update({ ...statusData }).returning('*');

      if (mappingData) {
        await tenantScopedTable(trx, 'project_status_mappings', tenant)
          .where('status_id', statusId)
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
      console.error('Error updating project status:', error);
      throw error;
    }
  },

  deleteProjectStatus: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, statusId: string): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting project status');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await knexOrTrx.transaction();

    try {
      // First, check if the status is being used by any tasks
      const tasksUsingStatus = await tenantScopedTable(trx, 'project_tasks', tenant)
        .where('project_status_mapping_id', statusId)
        .first();

      if (tasksUsingStatus) {
        throw new Error('Cannot delete status: it is being used by one or more tasks');
      }

      await tenantScopedTable(trx, 'project_status_mappings', tenant).where('status_id', statusId).del();

      await tenantScopedTable(trx, 'statuses', tenant).where('status_id', statusId).del();

      if (!isTransaction) {
        await trx.commit();
      }
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      console.error('Error deleting project status:', error);
      throw error;
    }
  },

  getPhaseById: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, phaseId: string): Promise<IProjectPhase | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project phase by ID');
    }

    try {
      const phase = await tenantScopedTable(knexOrTrx, 'project_phases', tenant).where('phase_id', phaseId).first() as IProjectPhase | undefined;
      return phase || null;
    } catch (error) {
      console.error('Error getting project phase by ID:', error);
      throw error;
    }
  },

  updateStructure: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    projectId: string,
    updates: { phases: Partial<IProjectPhase>[]; tasks: Partial<IProjectTask>[] }
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating project structure');
    }

    const isTransaction = (knexOrTrx as any).isTransaction || false;
    const trx = isTransaction ? (knexOrTrx as Knex.Transaction) : await knexOrTrx.transaction();

    try {
      for (const phase of updates.phases) {
        if (!phase.phase_id) {
          throw new Error('Phase ID is required for update');
        }
        // Remove wbs_code from updates to prevent override
        const { wbs_code: _wbs, ...phaseUpdate } = phase as any;
        await tenantScopedTable(trx, 'project_phases', tenant)
          .where({ project_id: projectId, phase_id: phase.phase_id })
          .update({
            ...phaseUpdate,
            updated_at: trx.fn.now(),
          });
      }
      for (const task of updates.tasks) {
        if (!task.task_id) {
          throw new Error('Task ID is required for update');
        }
        // Remove wbs_code from updates to prevent override
        const { wbs_code: _wbs, ...taskUpdate } = task as any;
        await tenantScopedTable(trx, 'project_tasks', tenant)
          .where({ task_id: task.task_id })
          .update({
            ...taskUpdate,
            updated_at: trx.fn.now(),
          });
      }

      if (!isTransaction) {
        await trx.commit();
      }
    } catch (error) {
      if (!isTransaction) {
        await trx.rollback();
      }
      console.error('Error updating project structure:', error);
      throw error;
    }
  },

  generateNextWbsCode: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, parentWbsCode: string): Promise<string> => {
    if (!tenant) {
      throw new Error('Tenant context is required for generating WBS codes');
    }

    try {
      // If no parent code, get next project number
      if (!parentWbsCode) {
        const projects = await tenantScopedTable(knexOrTrx, 'projects', tenant).whereNot('wbs_code', '').select('wbs_code') as Array<{ wbs_code: string }>;

        if (projects.length === 0) return '1';

        const numbers = projects
          .map((p): number => parseInt((p as any).wbs_code))
          .filter((n: number): boolean => !isNaN(n))
          .sort((a: number, b: number): number => b - a);

        return String(numbers[0] + 1);
      }

      // Split parent code into parts
      const parts = parentWbsCode.split('.');

      // For project level (single number), get next phase number
      if (parts.length === 1) {
        const phases = await tenantScopedTable(knexOrTrx, 'project_phases', tenant).where('wbs_code', 'like', `${parentWbsCode}.%`).select('wbs_code') as Array<{ wbs_code: string }>;

        if (phases.length === 0) return `${parentWbsCode}.1`;

        const numbers = phases
          .map((phase): number => {
            const phaseParts = (phase as any).wbs_code.split('.');
            return parseInt(phaseParts[1]);
          })
          .filter((n: number): boolean => !isNaN(n))
          .sort((a: number, b: number): number => b - a);

        return `${parentWbsCode}.${numbers[0] + 1}`;
      }

      // For phase level (two numbers), get next task number
      if (parts.length === 2) {
        const tasks = await tenantScopedTable(knexOrTrx, 'project_tasks', tenant).where('wbs_code', 'like', `${parentWbsCode}.%`).select('wbs_code') as Array<{ wbs_code: string }>;

        if (tasks.length === 0) return `${parentWbsCode}.1`;

        const numbers = tasks
          .map((task): number => {
            const taskParts = (task as any).wbs_code.split('.');
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

  getProjectStatusMapping: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    mappingId: string
  ): Promise<IProjectStatusMapping | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project status mapping');
    }

    try {
      const mapping = await tenantScopedTable(knexOrTrx, 'project_status_mappings', tenant)
        .where('project_status_mapping_id', mappingId)
        .first() as IProjectStatusMapping | undefined;
      return mapping || null;
    } catch (error) {
      console.error('Error getting project status mapping:', error);
      throw error;
    }
  },
};

export default ProjectModel;

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
import type { IProject, IProjectPhase, IProjectStatusMapping } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

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
        .leftJoin('clients', function () {
          this.on('projects.client_id', 'clients.client_id')
            .andOn('projects.tenant', 'clients.tenant');
        })
        .leftJoin('users', function () {
          this.on('projects.assigned_to', 'users.user_id')
            .andOn('projects.tenant', 'users.tenant');
        })
        .leftJoin('contacts', function () {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
            .andOn('projects.tenant', 'contacts.tenant');
        })
        .leftJoin('statuses as s', function () {
          this.on('projects.status', 's.status_id')
            .andOn('projects.tenant', 's.tenant');
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
        .leftJoin('clients', function () {
          this.on('projects.client_id', 'clients.client_id')
            .andOn('projects.tenant', 'clients.tenant');
        })
        .leftJoin('users', function () {
          this.on('projects.assigned_to', 'users.user_id')
            .andOn('projects.tenant', 'users.tenant');
        })
        .leftJoin('contacts', function () {
          this.on('projects.contact_name_id', 'contacts.contact_name_id')
            .andOn('projects.tenant', 'contacts.tenant');
        })
        .leftJoin('statuses as s', function () {
          this.on('projects.status', 's.status_id')
            .andOn('projects.tenant', 's.tenant');
        })
        .where('projects.project_id', projectId)
        .first();

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

      const [newProject] = await knexOrTrx<IProject>('projects')
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

      const [updatedProject] = await knexOrTrx<IProject>('projects')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
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

      // Finally, delete the project
      const deleted = await trx('projects')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
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
      const phases = await knexOrTrx<IProjectPhase>('project_phases')
        .where('project_id', projectId)
        .andWhere('tenant', tenant)
        .orderBy('wbs_code');

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
      const [updatedPhase] = await knexOrTrx<IProjectPhase>('project_phases')
        .where('phase_id', phaseId)
        .andWhere('tenant', tenant)
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
      const deleted = await trx('project_phases')
        .where('phase_id', phaseId)
        .andWhere('tenant', tenant)
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
    projectId: string
  ): Promise<IProjectStatusMapping[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting project status mappings');
    }

    try {
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

    const projects = await knexOrTrx<IProject>('projects')
      .where({
        client_id: clientId,
        tenant
      })
      .select('*');

    return projects;
  },
};

export default ProjectModel;

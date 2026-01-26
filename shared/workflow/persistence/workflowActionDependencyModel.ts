import { Knex } from 'knex';
import { IWorkflowActionDependency } from './workflowInterfaces';
import { withTransaction } from '@alga-psa/db';

/**
 * Model for workflow_action_dependencies table
 * Provides CRUD operations for workflow action dependencies
 */
const WorkflowActionDependencyModel = {
  /**
   * Get all dependencies for a specific action
   */
  getDependenciesForAction: async (knex: Knex, tenant: string, actionId: string): Promise<IWorkflowActionDependency[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const dependencies = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          action_id: actionId,
          tenant 
        })
        .select('*');
      
      return dependencies;
    } catch (error) {
      console.error(`Error getting dependencies for action ${actionId}:`, error);
      throw error;
    }
  },

  /**
   * Get all actions that depend on a specific action
   */
  getDependentsForAction: async (knex: Knex, tenant: string, dependsOnId: string): Promise<IWorkflowActionDependency[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const dependents = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          depends_on_id: dependsOnId,
          tenant 
        })
        .select('*');
      
      return dependents;
    } catch (error) {
      console.error(`Error getting dependents for action ${dependsOnId}:`, error);
      throw error;
    }
  },

  /**
   * Get all dependencies for a workflow execution
   */
  getByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowActionDependency[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const dependencies = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*');
      
      return dependencies;
    } catch (error) {
      console.error(`Error getting dependencies for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get all dependencies for a specific event
   */
  getByEventId: async (knex: Knex, tenant: string, eventId: string): Promise<IWorkflowActionDependency[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const dependencies = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .select('*');
      
      return dependencies;
    } catch (error) {
      console.error(`Error getting dependencies for event ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific dependency by ID
   */
  getById: async (knex: Knex, tenant: string, dependencyId: string): Promise<IWorkflowActionDependency | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const dependency = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          dependency_id: dependencyId,
          tenant 
        })
        .first();
      
      return dependency || null;
    } catch (error) {
      console.error(`Error getting dependency with id ${dependencyId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new dependency
   */
  create: async (knex: Knex, tenant: string, dependency: Omit<IWorkflowActionDependency, 'dependency_id' | 'created_at'>): Promise<Pick<IWorkflowActionDependency, 'dependency_id'>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedDependency] = await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .insert({
          ...dependency,
          tenant: tenant
        })
        .returning('dependency_id');
      
      return { dependency_id: insertedDependency.dependency_id };
    } catch (error) {
      console.error('Error creating action dependency:', error);
      throw error;
    }
  },

  /**
   * Create multiple dependencies in a single transaction
   */
  createMany: async (knex: Knex, tenant: string, dependencies: Omit<IWorkflowActionDependency, 'dependency_id' | 'created_at'>[]): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await withTransaction(knex, async (trx) => {
        const dependenciesWithTenant = dependencies.map(dep => ({
          ...dep,
          tenant
        }));
        
        await trx<IWorkflowActionDependency>('workflow_action_dependencies')
          .insert(dependenciesWithTenant);
      });
    } catch (error) {
      console.error('Error creating multiple action dependencies:', error);
      throw error;
    }
  },

  /**
   * Delete a dependency
   */
  delete: async (knex: Knex, tenant: string, dependencyId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          dependency_id: dependencyId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting dependency with id ${dependencyId}:`, error);
      throw error;
    }
  },

  /**
   * Delete all dependencies for an action
   */
  deleteForAction: async (knex: Knex, tenant: string, actionId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          action_id: actionId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting dependencies for action ${actionId}:`, error);
      throw error;
    }
  },

  /**
   * Delete all dependencies for an event
   */
  deleteForEvent: async (knex: Knex, tenant: string, eventId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionDependency>('workflow_action_dependencies')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting dependencies for event ${eventId}:`, error);
      throw error;
    }
  }
};

export default WorkflowActionDependencyModel;

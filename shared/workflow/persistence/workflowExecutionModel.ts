import { Knex } from 'knex';
import { IWorkflowExecution } from './index.js';

/**
 * Model for workflow_executions table
 * Provides CRUD operations for workflow executions
 */
const WorkflowExecutionModel = {
  /**
   * Get all workflow executions
   */
  getAll: async (knex: Knex, tenant: string): Promise<IWorkflowExecution[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const executions = await knex<IWorkflowExecution>('workflow_executions')
        .where({ tenant })
        .select('*');
      
      return executions;
    } catch (error) {
      console.error('Error getting all workflow executions:', error);
      throw error;
    }
  },

  /**
   * Get a workflow execution by ID
   */
  getById: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowExecution | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const execution = await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .first();
      
      return execution || null;
    } catch (error) {
      console.error(`Error getting workflow execution with id ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new workflow execution
   */
  create: async (knex: Knex, tenant: string, execution: Partial<IWorkflowExecution>): Promise<Pick<IWorkflowExecution, 'execution_id'>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Use provided execution_id if it exists, otherwise one will be generated
      const [insertedExecution] = await knex<IWorkflowExecution>('workflow_executions')
        .insert({
          ...execution,
          tenant: tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('execution_id');
      
      return { execution_id: insertedExecution.execution_id };
    } catch (error) {
      console.error('Error creating workflow execution:', error);
      throw error;
    }
  },

  /**
   * Update a workflow execution
   */
  update: async (knex: Knex, tenant: string, executionId: string, execution: Partial<IWorkflowExecution>): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .update({
          ...execution,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error updating workflow execution with id ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a workflow execution
   */
  delete: async (knex: Knex, tenant: string, executionId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting workflow execution with id ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get workflow executions by workflow name
   */
  getByWorkflowName: async (knex: Knex, tenant: string, workflowName: string): Promise<IWorkflowExecution[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const executions = await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          workflow_name: workflowName,
          tenant 
        })
        .select('*');
      
      return executions;
    } catch (error) {
      console.error(`Error getting workflow executions for workflow ${workflowName}:`, error);
      throw error;
    }
  },

  /**
   * Get workflow executions by current state
   */
  getByState: async (knex: Knex, tenant: string, state: string): Promise<IWorkflowExecution[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const executions = await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          current_state: state,
          tenant 
        })
        .select('*');
      
      return executions;
    } catch (error) {
      console.error(`Error getting workflow executions in state ${state}:`, error);
      throw error;
    }
  },

  /**
   * Get workflow executions by status
   */
  getByStatus: async (knex: Knex, tenant: string, status: string): Promise<IWorkflowExecution[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const executions = await knex<IWorkflowExecution>('workflow_executions')
        .where({ 
          status,
          tenant 
        })
        .select('*');
      
      return executions;
    } catch (error) {
      console.error(`Error getting workflow executions with status ${status}:`, error);
      throw error;
    }
  }
};

export default WorkflowExecutionModel;

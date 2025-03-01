import { createTenantKnex } from '@/lib/db';
import { IWorkflowActionResult } from './workflowInterfaces';

/**
 * Model for workflow_action_results table
 * Provides CRUD operations for workflow action results
 */
const WorkflowActionResultModel = {
  /**
   * Get all action results for a workflow execution
   */
  getByExecutionId: async (executionId: string): Promise<IWorkflowActionResult[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const results = await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return results;
    } catch (error) {
      console.error(`Error getting action results for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get action results for a specific event
   */
  getByEventId: async (eventId: string): Promise<IWorkflowActionResult[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const results = await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return results;
    } catch (error) {
      console.error(`Error getting action results for event ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific action result by ID
   */
  getById: async (resultId: string): Promise<IWorkflowActionResult | null> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const result = await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          result_id: resultId,
          tenant 
        })
        .first();
      
      return result || null;
    } catch (error) {
      console.error(`Error getting action result with id ${resultId}:`, error);
      throw error;
    }
  },

  /**
   * Get action result by idempotency key
   */
  getByIdempotencyKey: async (idempotencyKey: string): Promise<IWorkflowActionResult | null> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const result = await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          idempotency_key: idempotencyKey,
          tenant 
        })
        .first();
      
      return result || null;
    } catch (error) {
      console.error(`Error getting action result with idempotency key ${idempotencyKey}:`, error);
      throw error;
    }
  },

  /**
   * Create a new action result
   */
  create: async (actionResult: Omit<IWorkflowActionResult, 'result_id' | 'created_at'>): Promise<Pick<IWorkflowActionResult, 'result_id'>> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedResult] = await knex<IWorkflowActionResult>('workflow_action_results')
        .insert({
          ...actionResult,
          tenant: tenant
        })
        .returning('result_id');
      
      return { result_id: insertedResult.result_id };
    } catch (error) {
      console.error('Error creating action result:', error);
      throw error;
    }
  },

  /**
   * Update an action result
   */
  update: async (resultId: string, actionResult: Partial<IWorkflowActionResult>): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          result_id: resultId,
          tenant 
        })
        .update(actionResult);
    } catch (error) {
      console.error(`Error updating action result with id ${resultId}:`, error);
      throw error;
    }
  },

  /**
   * Mark an action as started
   */
  markAsStarted: async (resultId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          result_id: resultId,
          tenant 
        })
        .update({
          started_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking action ${resultId} as started:`, error);
      throw error;
    }
  },

  /**
   * Mark an action as completed
   */
  markAsCompleted: async (resultId: string, success: boolean, result?: Record<string, any>, errorMessage?: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          result_id: resultId,
          tenant 
        })
        .update({
          success,
          result: result ? result : undefined,
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking action ${resultId} as completed:`, error);
      throw error;
    }
  },

  /**
   * Get actions that are ready to execute
   */
  getReadyToExecute: async (): Promise<IWorkflowActionResult[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const results = await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          ready_to_execute: true,
          tenant 
        })
        .whereNull('started_at')
        .select('*')
        .orderBy('created_at', 'asc');
      
      return results;
    } catch (error) {
      console.error('Error getting actions ready to execute:', error);
      throw error;
    }
  },

  /**
   * Delete an action result
   */
  delete: async (resultId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowActionResult>('workflow_action_results')
        .where({ 
          result_id: resultId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting action result with id ${resultId}:`, error);
      throw error;
    }
  }
};

export default WorkflowActionResultModel;
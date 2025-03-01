import { createTenantKnex } from '@/lib/db';
import { IWorkflowTimer } from './workflowInterfaces';

/**
 * Model for workflow_timers table
 * Provides CRUD operations for workflow timers
 */
const WorkflowTimerModel = {
  /**
   * Get all timers for a workflow execution
   */
  getByExecutionId: async (executionId: string): Promise<IWorkflowTimer[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const timers = await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return timers;
    } catch (error) {
      console.error(`Error getting timers for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get active timers for a workflow execution
   */
  getActiveByExecutionId: async (executionId: string): Promise<IWorkflowTimer[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const timers = await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          execution_id: executionId,
          status: 'active',
          tenant 
        })
        .select('*')
        .orderBy('fire_time', 'asc');
      
      return timers;
    } catch (error) {
      console.error(`Error getting active timers for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific timer by ID
   */
  getById: async (timerId: string): Promise<IWorkflowTimer | null> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const timer = await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          timer_id: timerId,
          tenant 
        })
        .first();
      
      return timer || null;
    } catch (error) {
      console.error(`Error getting timer with id ${timerId}:`, error);
      throw error;
    }
  },

  /**
   * Get timers by name for a workflow execution
   */
  getByName: async (executionId: string, timerName: string): Promise<IWorkflowTimer[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const timers = await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          execution_id: executionId,
          timer_name: timerName,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return timers;
    } catch (error) {
      console.error(`Error getting timers with name ${timerName} for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get all active timers that are due to fire
   */
  getDueTimers: async (): Promise<IWorkflowTimer[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const now = new Date().toISOString();
      
      const timers = await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          status: 'active',
          tenant 
        })
        .where('fire_time', '<=', now)
        .select('*')
        .orderBy('fire_time', 'asc');
      
      return timers;
    } catch (error) {
      console.error('Error getting due timers:', error);
      throw error;
    }
  },

  /**
   * Create a new timer
   */
  create: async (timer: Omit<IWorkflowTimer, 'timer_id' | 'created_at'>): Promise<Pick<IWorkflowTimer, 'timer_id'>> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedTimer] = await knex<IWorkflowTimer>('workflow_timers')
        .insert({
          ...timer,
          tenant: tenant
        })
        .returning('timer_id');
      
      return { timer_id: insertedTimer.timer_id };
    } catch (error) {
      console.error('Error creating timer:', error);
      throw error;
    }
  },

  /**
   * Update a timer
   */
  update: async (timerId: string, timer: Partial<IWorkflowTimer>): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          timer_id: timerId,
          tenant 
        })
        .update(timer);
    } catch (error) {
      console.error(`Error updating timer with id ${timerId}:`, error);
      throw error;
    }
  },

  /**
   * Mark a timer as fired
   */
  markAsFired: async (timerId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          timer_id: timerId,
          tenant 
        })
        .update({
          status: 'fired'
        });
    } catch (error) {
      console.error(`Error marking timer ${timerId} as fired:`, error);
      throw error;
    }
  },

  /**
   * Mark a timer as canceled
   */
  markAsCanceled: async (timerId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          timer_id: timerId,
          tenant 
        })
        .update({
          status: 'canceled'
        });
    } catch (error) {
      console.error(`Error marking timer ${timerId} as canceled:`, error);
      throw error;
    }
  },

  /**
   * Cancel all active timers for a workflow execution
   */
  cancelAllForExecution: async (executionId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          execution_id: executionId,
          status: 'active',
          tenant 
        })
        .update({
          status: 'canceled'
        });
    } catch (error) {
      console.error(`Error canceling all timers for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Cancel all active timers for a specific state in a workflow execution
   */
  cancelAllForState: async (executionId: string, stateName: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          execution_id: executionId,
          state_name: stateName,
          status: 'active',
          tenant 
        })
        .update({
          status: 'canceled'
        });
    } catch (error) {
      console.error(`Error canceling timers for state ${stateName} in execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a timer
   */
  delete: async (timerId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowTimer>('workflow_timers')
        .where({ 
          timer_id: timerId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting timer with id ${timerId}:`, error);
      throw error;
    }
  }
};

export default WorkflowTimerModel;
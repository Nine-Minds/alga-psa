import { Knex } from 'knex';
import { IWorkflowSyncPoint } from './workflowInterfaces';
import { withTransaction } from '@alga-psa/db';

/**
 * Model for workflow_sync_points table
 * Provides CRUD operations for workflow synchronization points
 */
const WorkflowSyncPointModel = {
  /**
   * Get all sync points for a workflow execution
   */
  getByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowSyncPoint[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const syncPoints = await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return syncPoints;
    } catch (error) {
      console.error(`Error getting sync points for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get sync points for a specific event
   */
  getByEventId: async (knex: Knex, tenant: string, eventId: string): Promise<IWorkflowSyncPoint[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const syncPoints = await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return syncPoints;
    } catch (error) {
      console.error(`Error getting sync points for event ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific sync point by ID
   */
  getById: async (knex: Knex, tenant: string, syncId: string): Promise<IWorkflowSyncPoint | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const syncPoint = await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          sync_id: syncId,
          tenant 
        })
        .first();
      
      return syncPoint || null;
    } catch (error) {
      console.error(`Error getting sync point with id ${syncId}:`, error);
      throw error;
    }
  },

  /**
   * Get all pending sync points
   */
  getPendingSyncPoints: async (knex: Knex, tenant: string): Promise<IWorkflowSyncPoint[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const syncPoints = await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          status: 'pending',
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return syncPoints;
    } catch (error) {
      console.error('Error getting pending sync points:', error);
      throw error;
    }
  },

  /**
   * Create a new sync point
   */
  create: async (knex: Knex, tenant: string, syncPoint: Omit<IWorkflowSyncPoint, 'sync_id' | 'created_at'>): Promise<Pick<IWorkflowSyncPoint, 'sync_id'>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedSyncPoint] = await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .insert({
          ...syncPoint,
          tenant: tenant
        })
        .returning('sync_id');
      
      return { sync_id: insertedSyncPoint.sync_id };
    } catch (error) {
      console.error('Error creating sync point:', error);
      throw error;
    }
  },

  /**
   * Update a sync point
   */
  update: async (knex: Knex, tenant: string, syncId: string, syncPoint: Partial<IWorkflowSyncPoint>): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          sync_id: syncId,
          tenant 
        })
        .update(syncPoint);
    } catch (error) {
      console.error(`Error updating sync point with id ${syncId}:`, error);
      throw error;
    }
  },

  /**
   * Increment the completed actions count for a sync point
   */
  incrementCompletedActions: async (knex: Knex, tenant: string, syncId: string): Promise<IWorkflowSyncPoint> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Use a transaction to ensure atomicity
      const result = await withTransaction(knex, async (trx) => {
        // Get the current sync point with a lock
        const syncPoint = await trx<IWorkflowSyncPoint>('workflow_sync_points')
          .where({ 
            sync_id: syncId,
            tenant 
          })
          .forUpdate()
          .first();
        
        if (!syncPoint) {
          throw new Error(`Sync point with id ${syncId} not found`);
        }
        
        // Increment the completed actions count
        const updatedCount = syncPoint.completed_actions + 1;
        
        // Check if all actions are completed
        const isComplete = updatedCount >= syncPoint.total_actions;
        
        // Update the sync point
        const updateData: Partial<IWorkflowSyncPoint> = {
          completed_actions: updatedCount
        };
        
        // If all actions are completed, update the status and completed_at
        if (isComplete) {
          updateData.status = 'completed';
          updateData.completed_at = new Date().toISOString();
        }
        
        await trx<IWorkflowSyncPoint>('workflow_sync_points')
          .where({ 
            sync_id: syncId,
            tenant 
          })
          .update(updateData);
        
        // Return the updated sync point
        return {
          ...syncPoint,
          ...updateData
        };
      });
      
      return result;
    } catch (error) {
      console.error(`Error incrementing completed actions for sync point ${syncId}:`, error);
      throw error;
    }
  },

  /**
   * Mark a sync point as completed
   */
  markAsCompleted: async (knex: Knex, tenant: string, syncId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          sync_id: syncId,
          tenant 
        })
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking sync point ${syncId} as completed:`, error);
      throw error;
    }
  },

  /**
   * Mark a sync point as failed
   */
  markAsFailed: async (knex: Knex, tenant: string, syncId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          sync_id: syncId,
          tenant 
        })
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking sync point ${syncId} as failed:`, error);
      throw error;
    }
  },

  /**
   * Delete a sync point
   */
  delete: async (knex: Knex, tenant: string, syncId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowSyncPoint>('workflow_sync_points')
        .where({ 
          sync_id: syncId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting sync point with id ${syncId}:`, error);
      throw error;
    }
  }
};

export default WorkflowSyncPointModel;

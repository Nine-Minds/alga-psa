import { Knex } from 'knex';
import { WorkflowStateSnapshot } from '../core/workflowEventSourcing';
import { logger } from '@alga-psa/core';

/**
 * Interface for workflow state snapshots in the database
 */
export interface IWorkflowSnapshot {
  snapshot_id: string;
  execution_id: string;
  tenant: string;
  version: number;
  current_state: string;
  data: Record<string, any>;
  created_at: string;
}

/**
 * Model for workflow_snapshots table
 * Provides operations for storing and retrieving workflow state snapshots
 * These snapshots optimize event replay by providing a starting point
 */
const WorkflowSnapshotModel = {
  /**
   * Get the latest snapshot for a workflow execution
   */
  getLatestByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowSnapshot | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const snapshot = await knex<IWorkflowSnapshot>('workflow_snapshots')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .orderBy('version', 'desc')
        .first();
      
      return snapshot || null;
    } catch (error) {
      logger.error(`[WorkflowSnapshotModel] Error getting latest snapshot for execution ${executionId}:`, error);
      throw error;
    }
  },
  
  /**
   * Get a specific snapshot by version
   */
  getByVersion: async (knex: Knex, tenant: string, executionId: string, version: number): Promise<IWorkflowSnapshot | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const snapshot = await knex<IWorkflowSnapshot>('workflow_snapshots')
        .where({ 
          execution_id: executionId,
          version,
          tenant 
        })
        .first();
      
      return snapshot || null;
    } catch (error) {
      logger.error(`[WorkflowSnapshotModel] Error getting snapshot for execution ${executionId} version ${version}:`, error);
      throw error;
    }
  },
  
  /**
   * Create a new snapshot
   */
  create: async (knex: Knex, tenant: string, snapshot: WorkflowStateSnapshot): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Generate a unique snapshot ID
      const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      await knex('workflow_snapshots').insert({
        snapshot_id: snapshotId,
        execution_id: snapshot.executionId,
        tenant,
        version: snapshot.version,
        current_state: snapshot.currentState,
        data: snapshot.data,
        created_at: snapshot.timestamp
      });
      
      logger.info(`[WorkflowSnapshotModel] Created snapshot ${snapshotId} for execution ${snapshot.executionId} at version ${snapshot.version}`);
    } catch (error) {
      logger.error(`[WorkflowSnapshotModel] Error creating snapshot for execution ${snapshot.executionId}:`, error);
      throw error;
    }
  },
  
  /**
   * Delete old snapshots, keeping only the most recent ones
   */
  pruneSnapshots: async (knex: Knex, tenant: string, executionId: string, keepCount: number = 5): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Get the IDs of snapshots to keep
      const snapshotsToKeep = await knex<IWorkflowSnapshot>('workflow_snapshots')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .orderBy('version', 'desc')
        .limit(keepCount)
        .pluck('snapshot_id');
      
      // Delete all other snapshots
      const deleted = await knex('workflow_snapshots')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .whereNotIn('snapshot_id', snapshotsToKeep)
        .del();
      
      if (deleted > 0) {
        logger.info(`[WorkflowSnapshotModel] Pruned ${deleted} old snapshots for execution ${executionId}`);
      }
    } catch (error) {
      logger.error(`[WorkflowSnapshotModel] Error pruning snapshots for execution ${executionId}:`, error);
      throw error;
    }
  },
  
  /**
   * Check if a snapshot exists for a specific version
   */
  exists: async (knex: Knex, tenant: string, executionId: string, version: number): Promise<boolean> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const count = await knex('workflow_snapshots')
        .where({ 
          execution_id: executionId,
          version,
          tenant 
        })
        .count<[{ count: number }]>('* as count')
        .first();
      
      return count ? count.count > 0 : false;
    } catch (error) {
      logger.error(`[WorkflowSnapshotModel] Error checking if snapshot exists for execution ${executionId} version ${version}:`, error);
      throw error;
    }
  }
};

export default WorkflowSnapshotModel;

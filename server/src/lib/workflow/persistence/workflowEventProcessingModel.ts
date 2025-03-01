import { createTenantKnex } from '@/lib/db';
import { WorkflowEventProcessingStatus } from '../streams/workflowEventSchema';

/**
 * Interface for workflow_event_processing table
 */
export interface IWorkflowEventProcessing {
  processing_id: string;
  event_id: string;
  execution_id: string;
  tenant: string;
  status: WorkflowEventProcessingStatus;
  worker_id?: string;
  attempt_count: number;
  last_attempt?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Model for workflow_event_processing table
 * Provides CRUD operations for tracking workflow event processing status
 */
const WorkflowEventProcessingModel = {
  /**
   * Get all processing records for a workflow event
   */
  getByEventId: async (eventId: string): Promise<IWorkflowEventProcessing[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const records = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return records;
    } catch (error) {
      console.error(`Error getting processing records for event ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Get all processing records for a workflow execution
   */
  getByExecutionId: async (executionId: string): Promise<IWorkflowEventProcessing[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const records = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return records;
    } catch (error) {
      console.error(`Error getting processing records for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific processing record by ID
   */
  getById: async (processingId: string): Promise<IWorkflowEventProcessing | null> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const record = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .first();
      
      return record || null;
    } catch (error) {
      console.error(`Error getting processing record with id ${processingId}:`, error);
      throw error;
    }
  },

  /**
   * Get the latest processing record for a workflow event
   */
  getLatestByEventId: async (eventId: string): Promise<IWorkflowEventProcessing | null> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const record = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .orderBy('created_at', 'desc')
        .first();
      
      return record || null;
    } catch (error) {
      console.error(`Error getting latest processing record for event ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new processing record
   */
  create: async (record: Omit<IWorkflowEventProcessing, 'processing_id' | 'created_at' | 'updated_at'>): Promise<Pick<IWorkflowEventProcessing, 'processing_id'>> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedRecord] = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .insert({
          ...record,
          tenant: tenant
        })
        .returning('processing_id');
      
      return { processing_id: insertedRecord.processing_id };
    } catch (error) {
      console.error('Error creating processing record:', error);
      throw error;
    }
  },

  /**
   * Update a processing record
   */
  update: async (processingId: string, record: Partial<IWorkflowEventProcessing>): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          ...record,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error updating processing record with id ${processingId}:`, error);
      throw error;
    }
  },

  /**
   * Update the status of a processing record
   */
  updateStatus: async (processingId: string, status: WorkflowEventProcessingStatus, errorMessage?: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const updateData: Partial<IWorkflowEventProcessing> = {
        status,
        updated_at: new Date().toISOString()
      };

      if (status === 'processing' || status === 'retrying') {
        updateData.last_attempt = new Date().toISOString();
        updateData.attempt_count = knex.raw('attempt_count + 1') as any;
      }

      if (errorMessage) {
        updateData.error_message = errorMessage;
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update(updateData);
    } catch (error) {
      console.error(`Error updating status for processing record ${processingId}:`, error);
      throw error;
    }
  },

  /**
   * Mark a processing record as published to Redis
   */
  markAsPublished: async (processingId: string, workerId?: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          status: 'published',
          worker_id: workerId,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking processing record ${processingId} as published:`, error);
      throw error;
    }
  },

  /**
   * Mark a processing record as processing
   */
  markAsProcessing: async (processingId: string, workerId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          status: 'processing',
          worker_id: workerId,
          last_attempt: new Date().toISOString(),
          attempt_count: knex.raw('attempt_count + 1') as any,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking processing record ${processingId} as processing:`, error);
      throw error;
    }
  },

  /**
   * Mark a processing record as completed
   */
  markAsCompleted: async (processingId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking processing record ${processingId} as completed:`, error);
      throw error;
    }
  },

  /**
   * Mark a processing record as failed
   */
  markAsFailed: async (processingId: string, errorMessage: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          status: 'failed',
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking processing record ${processingId} as failed:`, error);
      throw error;
    }
  },

  /**
   * Mark a processing record as retrying
   */
  markAsRetrying: async (processingId: string, workerId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .update({
          status: 'retrying',
          worker_id: workerId,
          last_attempt: new Date().toISOString(),
          attempt_count: knex.raw('attempt_count + 1') as any,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error marking processing record ${processingId} as retrying:`, error);
      throw error;
    }
  },

  /**
   * Get all events that need to be processed
   */
  getPendingEvents: async (limit: number = 100): Promise<IWorkflowEventProcessing[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const records = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          tenant,
          status: 'pending'
        })
        .select('*')
        .orderBy('created_at', 'asc')
        .limit(limit);
      
      return records;
    } catch (error) {
      console.error('Error getting pending events:', error);
      throw error;
    }
  },

  /**
   * Get all events that need to be retried
   */
  getEventsToRetry: async (limit: number = 100, maxAttempts: number = 3): Promise<IWorkflowEventProcessing[]> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const records = await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          tenant,
          status: 'failed'
        })
        .where('attempt_count', '<', maxAttempts)
        .select('*')
        .orderBy('created_at', 'asc')
        .limit(limit);
      
      return records;
    } catch (error) {
      console.error('Error getting events to retry:', error);
      throw error;
    }
  },

  /**
   * Delete a processing record
   */
  delete: async (processingId: string): Promise<void> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEventProcessing>('workflow_event_processing')
        .where({ 
          processing_id: processingId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting processing record with id ${processingId}:`, error);
      throw error;
    }
  }
};

export default WorkflowEventProcessingModel;
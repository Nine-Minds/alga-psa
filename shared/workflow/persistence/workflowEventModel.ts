import { Knex } from 'knex';
import { IWorkflowEvent } from './index';
import { withTransaction } from '@alga-psa/db';

/**
 * Model for workflow_events table
 * Provides CRUD operations for workflow events with optimizations for event sourcing
 */
const WorkflowEventModel = {
  /**
   * Get all events for a workflow execution in chronological order
   * This is the primary method used for event replay
   */
  getByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowEvent[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Optimize query for CitusDB by including tenant in WHERE clause
      // Order by created_at to ensure events are processed in the correct order
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc');
      
      return events;
    } catch (error) {
      console.error(`Error getting events for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get events for a workflow execution with pagination
   * This is useful for UIs and when dealing with large event logs
   */
  getByExecutionIdPaginated: async (
    knex: Knex,
    tenant: string,
    executionId: string, 
    page: number = 1, 
    pageSize: number = 100
  ): Promise<{ events: IWorkflowEvent[], total: number }> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Calculate offset
      const offset = (page - 1) * pageSize;
      
      // Get total count (for pagination)
      const [{ count }] = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .count<[{ count: number }]>('* as count');
      
      // Get paginated events
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'asc')
        .limit(pageSize)
        .offset(offset);
      
      return {
        events,
        total: Number(count)
      };
    } catch (error) {
      console.error(`Error getting paginated events for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Get events for a workflow execution up to a specific point in time
   * This is useful for time-travel debugging and historical state reconstruction
   */
  getByExecutionIdUntil: async (knex: Knex, tenant: string, executionId: string, until: string): Promise<IWorkflowEvent[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({
          execution_id: executionId,
          tenant
        })
        .where('created_at', '<=', until)
        .select('*')
        .orderBy('created_at', 'asc');
      
      return events;
    } catch (error) {
      console.error(`Error getting events for execution ${executionId} until ${until}:`, error);
      throw error;
    }
  },
  
  /**
   * Get events for a workflow execution after a specific point in time
   * This is useful for replaying events from a snapshot
   */
  getByExecutionIdAfter: async (knex: Knex, tenant: string, executionId: string, after: string): Promise<IWorkflowEvent[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({
          execution_id: executionId,
          tenant
        })
        .where('created_at', '>', after)
        .select('*')
        .orderBy('created_at', 'asc');
      
      return events;
    } catch (error) {
      console.error(`Error getting events for execution ${executionId} after ${after}:`, error);
      throw error;
    }
  },
  
  /**
   * Get events for a workflow execution between two points in time
   * This is useful for replaying events from a snapshot up to a specific point
   */
  getByExecutionIdBetween: async (knex: Knex, tenant: string, executionId: string, after: string, until: string): Promise<IWorkflowEvent[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({
          execution_id: executionId,
          tenant
        })
        .where('created_at', '>', after)
        .where('created_at', '<=', until)
        .select('*')
        .orderBy('created_at', 'asc');
      
      return events;
    } catch (error) {
      console.error(`Error getting events for execution ${executionId} between ${after} and ${until}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific event by ID
   */
  getById: async (knex: Knex, tenant: string, eventId: string): Promise<IWorkflowEvent | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const event = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          event_id: eventId,
          tenant 
        })
        .first();
      
      return event || null;
    } catch (error) {
      console.error(`Error getting event with id ${eventId}:`, error);
      throw error;
    }
  },

  /**
   * Get the latest event for a workflow execution
   * This is useful for quickly determining the current state
   */
  getLatestByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<IWorkflowEvent | null> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const event = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .orderBy('created_at', 'desc')
        .first();
      
      return event || null;
    } catch (error) {
      console.error(`Error getting latest event for execution ${executionId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new event
   */
  create: async (knex: Knex, tenant: string, event: Omit<IWorkflowEvent, 'event_id' | 'created_at'>): Promise<Pick<IWorkflowEvent, 'event_id'>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const [insertedEvent] = await knex<IWorkflowEvent>('workflow_events')
        .insert({
          ...event,
          tenant: tenant
        })
        .returning('event_id');
      
      return { event_id: insertedEvent.event_id };
    } catch (error) {
      console.error('Error creating event:', error);
      throw error;
    }
  },

  /**
   * Create a new event and update the workflow execution's current state in a single transaction
   * This ensures consistency between events and the execution state
   */
  createAndUpdateState: async (
    knex: Knex,
    tenant: string,
    event: Omit<IWorkflowEvent, 'event_id' | 'created_at'>,
    newState: string
  ): Promise<Pick<IWorkflowEvent, 'event_id'>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      // Use a transaction to ensure atomicity
      const result = await withTransaction(knex, async (trx) => {
        // Insert the event
        const [insertedEvent] = await trx<IWorkflowEvent>('workflow_events')
          .insert({
            ...event,
            tenant: tenant
          })
          .returning('event_id');
        
        // Update the workflow execution's current state
        await trx('workflow_executions')
          .where({ 
            execution_id: event.execution_id,
            tenant 
          })
          .update({
            current_state: newState,
            updated_at: new Date().toISOString()
          });
        
        return { event_id: insertedEvent.event_id };
      });
      
      return result;
    } catch (error) {
      console.error('Error creating event and updating state:', error);
      throw error;
    }
  },

  /**
   * Batch load events for multiple workflow executions
   * This is useful for processing multiple workflows efficiently
   */
  batchGetByExecutionIds: async (knex: Knex, tenant: string, executionIds: string[]): Promise<Record<string, IWorkflowEvent[]>> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      if (executionIds.length === 0) {
        return {};
      }
      
      // Get all events for the specified executions
      const events = await knex<IWorkflowEvent>('workflow_events')
        .whereIn('execution_id', executionIds)
        .andWhere({ tenant })
        .select('*')
        .orderBy([
          { column: 'execution_id', order: 'asc' },
          { column: 'created_at', order: 'asc' }
        ]);
      
      // Group events by execution_id
      const eventsByExecution: Record<string, IWorkflowEvent[]> = {};
      
      for (const event of events) {
        if (!eventsByExecution[event.execution_id]) {
          eventsByExecution[event.execution_id] = [];
        }
        
        eventsByExecution[event.execution_id].push(event);
      }
      
      return eventsByExecution;
    } catch (error) {
      console.error(`Error batch loading events for executions:`, error);
      throw error;
    }
  },

  /**
   * Get events by type for analytics and reporting
   */
  getByEventType: async (knex: Knex, tenant: string, eventType: string, limit: number = 100): Promise<IWorkflowEvent[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const events = await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          event_type: eventType,
          tenant 
        })
        .select('*')
        .orderBy('created_at', 'desc')
        .limit(limit);
      
      return events;
    } catch (error) {
      console.error(`Error getting events of type ${eventType}:`, error);
      throw error;
    }
  },

  /**
   * Delete events for a workflow execution
   * This should be used with caution as it affects the event log integrity
   */
  deleteByExecutionId: async (knex: Knex, tenant: string, executionId: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await knex<IWorkflowEvent>('workflow_events')
        .where({ 
          execution_id: executionId,
          tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting events for execution ${executionId}:`, error);
      throw error;
    }
  }
};

export default WorkflowEventModel;

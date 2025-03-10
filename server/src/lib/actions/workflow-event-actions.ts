'use server';

import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { workflowConfig } from '../../config/workflowConfig';
import { getCurrentUser } from './user-actions/userActions';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../db';
import { getEventBus } from '../eventBus';

/**
 * Options for submitting a workflow event
 */
export interface SubmitWorkflowEventOptions {
  execution_id?: string;
  event_name: string;
  event_type?: string;
  payload?: any;
  idempotency_key?: string;
  tenant?: string;
}

/**
 * Result of submitting a workflow event
 */
export interface SubmitWorkflowEventResult {
  eventId?: string;
  processingId?: string;
  currentState?: string;
  isComplete?: boolean;
  message: string;
  status: 'accepted' | 'processed' | 'error';
}

/**
 * Submit an event to a workflow execution
 * Uses the "fire and forget" pattern in distributed mode
 * Uses synchronous processing in non-distributed mode
 */
export async function submitWorkflowEventAction(
  options: SubmitWorkflowEventOptions
): Promise<SubmitWorkflowEventResult> {
  try {
    // Get current user
    const currentUser = await getCurrentUser();
    if (!currentUser?.tenant && !options.tenant) {
      throw new Error('No tenant specified and no current user found');
    }

    const { knex } = await createTenantKnex();
    
    const { execution_id, event_name, event_type = 'USER_SUBMITTED', payload, idempotency_key } = options;
    const tenant = options.tenant || currentUser!.tenant;
    const user_id = currentUser?.user_id;
    
    // Get workflow runtime
    const runtime = getWorkflowRuntime();
    
    if (execution_id) {
      // Direct execution path - submit to a specific workflow execution
      if (workflowConfig.distributedMode) {
        // Use distributed mode - enqueue event for asynchronous processing
        const result = await runtime.enqueueEvent(knex, {
          execution_id,
          event_name,
          payload,
          user_id,
          tenant,
          idempotency_key
        });
        
        return {
          eventId: result.eventId,
          processingId: result.processingId,
          message: 'Event accepted for processing',
          status: 'accepted'
        };
      } else {
        // Use synchronous mode - process event immediately
        const result = await runtime.submitEvent(knex, {
          execution_id,
          event_name,
          payload,
          user_id,
          tenant
        });
        
        return {
          currentState: result.currentState,
          isComplete: result.isComplete,
          message: 'Event processed successfully',
          status: 'processed'
        };
      }
    } else {
      // Event-driven path - publish to event bus and let attached workflows handle it
      
      // Import here to avoid circular dependencies
      const { getWorkflowsForEventType } = await import('./workflow-event-attachment-actions');
      
      // Get the event bus
      const eventBus = getEventBus();
      
      // Publish the event to the event bus
      await eventBus.publish({
        eventType: event_type as any,
        payload: {
          ...payload,
          tenantId: tenant,
          userId: user_id,
          eventName: event_name
        }
      });
      
      // Find workflows attached to this event type
      const workflowIds = await getWorkflowsForEventType({
        eventType: event_type,
        tenant
      });
      
      if (workflowIds.length === 0) {
        return {
          message: `Event published, but no workflows are attached to event type: ${event_type}`,
          status: 'accepted'
        };
      }
      
      // Return success
      return {
        message: `Event published to ${workflowIds.length} attached workflow(s)`,
        status: 'accepted'
      };
    }
  } catch (error) {
    logger.error('[submitWorkflowEventAction] Error submitting workflow event:', error);
    
    return {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: 'error'
    };
  }
}
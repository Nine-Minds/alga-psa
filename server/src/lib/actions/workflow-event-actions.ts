'use server';

import { createTenantKnex } from '@/lib/db';
import { getWorkflowRuntime } from '../workflow/core/workflowRuntime';
import { workflowConfig } from '../../config/workflowConfig';
import { getCurrentUser } from './user-actions/userActions';
import logger from '../../utils/logger';

/**
 * Options for submitting a workflow event
 */
export interface SubmitWorkflowEventOptions {
  execution_id: string;
  event_name: string;
  payload?: any;
  idempotency_key?: string;
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
    if (!currentUser?.tenant) {
      throw new Error('No current user found');
    }
    
    const { execution_id, event_name, payload, idempotency_key } = options;
    const tenant = currentUser.tenant;
    const user_id = currentUser.user_id;
    
    // Get workflow runtime
    const runtime = getWorkflowRuntime();
    
    if (workflowConfig.distributedMode) {
      // Use distributed mode - enqueue event for asynchronous processing
      const result = await runtime.enqueueEvent({
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
      const result = await runtime.submitEvent({
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
  } catch (error) {
    logger.error('[submitWorkflowEventAction] Error submitting workflow event:', error);
    
    return {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: 'error'
    };
  }
}
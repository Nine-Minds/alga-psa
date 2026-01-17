'use server';

import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core';
import { getActionRegistry } from '@alga-psa/shared/workflow/core';
import { workflowConfig } from 'server/src/config/workflowConfig';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { getEventBus } from 'server/src/lib/eventBus';
import { EventCatalogModel } from 'server/src/models/eventCatalog'; // Added import
import { getWorkflowsForEventType } from './workflow-event-attachment-actions';

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
 * Uses the "fire and forget" pattern - events are enqueued for asynchronous processing
 */
export async function submitWorkflowEventAction(
  options: SubmitWorkflowEventOptions
): Promise<SubmitWorkflowEventResult> {
  logger.info('[submitWorkflowEventAction] Starting event submission', {
    execution_id: options.execution_id,
    event_name: options.event_name,
    event_type: options.event_type,
    idempotency_key: options.idempotency_key,
    has_payload: options.payload ? true : false,
    tenant: options.tenant
  });
  
  try {
    // Get current user
    logger.info('[submitWorkflowEventAction] Retrieving current user');
    const currentUser = await getCurrentUser();
    
    if (!currentUser?.tenant && !options.tenant) {
      logger.error('[submitWorkflowEventAction] No tenant specified and no current user found');
      throw new Error('No tenant specified and no current user found');
    }

    logger.info('[submitWorkflowEventAction] Initializing database connection');
    const { knex } = await createTenantKnex();
    
    const { execution_id, event_name, event_type = 'USER_SUBMITTED', payload, idempotency_key } = options;
    const tenant = options.tenant || currentUser!.tenant;
    const user_id = currentUser?.user_id;
    
    logger.info('[submitWorkflowEventAction] User and tenant context', {
      tenant,
      user_id,
      execution_path: execution_id ? 'direct' : 'event-driven'
    });
    
    // Get workflow runtime
    logger.info('[submitWorkflowEventAction] Initializing action registry and workflow runtime');
    const actionRegistry = getActionRegistry();
    const runtime = getWorkflowRuntime(actionRegistry);
    
    if (execution_id) {
      // Direct execution path - submit to a specific workflow execution
      logger.info('[submitWorkflowEventAction] Processing direct execution path', {
        execution_id,
        event_name
      });
      
      // Always use distributed mode - enqueue event for asynchronous processing
      logger.info('[submitWorkflowEventAction] Enqueuing event for asynchronous processing');
      const result = await runtime.enqueueEvent(knex, {
        execution_id,
        event_name,
        payload,
        user_id,
        tenant,
        idempotency_key
      });
      
      logger.info('[submitWorkflowEventAction] Event successfully enqueued', {
        eventId: result.eventId,
        processingId: result.processingId,
        execution_id
      });
      
      return {
        eventId: result.eventId,
        processingId: result.processingId,
        message: 'Event accepted for processing',
        status: 'accepted'
      };
    } else {
      // Event-driven path - publish to event bus and let attached workflows handle it      
      logger.info('[submitWorkflowEventAction] Processing event-driven path', {
        event_type,
        event_name
      });
      
      // --- START NEW VALIDATION ---
      // Validate event_type against both catalogs
      const tenantEvent = await EventCatalogModel.getByEventType(knex, event_type, tenant);
      let systemEvent = null;
      if (!tenantEvent) {
        // Check system catalog only if not found in tenant catalog
        systemEvent = await knex('system_event_catalog')
          .where({ event_type: event_type })
          .first();
      }

      if (!tenantEvent && !systemEvent) {
        logger.error(`[submitWorkflowEventAction] Event type "${event_type}" not found in tenant or system catalog for tenant ${tenant}`);
        // Throw an error to prevent publishing potentially invalid events
        throw new Error(`Event type "${event_type}" is not defined.`);
      }
      logger.info(`[submitWorkflowEventAction] Event type "${event_type}" validated successfully.`);
      // --- END NEW VALIDATION ---

      // Get the event bus
      logger.info('[submitWorkflowEventAction] Initializing event bus');
      const eventBus = getEventBus();

      // Publish the event to the event bus
      logger.info('[submitWorkflowEventAction] Publishing event to event bus', {
        eventType: event_type
      });
      
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
      logger.info('[submitWorkflowEventAction] Finding workflows attached to event type', {
        eventType: event_type,
        tenant
      });
      
      // This call should now correctly find tenant workflows attached to the event_type
      const workflowAttachments = await getWorkflowsForEventType({
        eventType: event_type,
        tenant
      });
      
      logger.info('[submitWorkflowEventAction] Found attached workflows', {
        count: workflowAttachments.length,
        // Log workflow IDs and whether they are system managed (though system managed shouldn't appear here yet)
        attachments: workflowAttachments.map(a => ({ id: a.workflow_id, system: a.isSystemManaged }))
      });

      if (workflowAttachments.length === 0) {
        logger.warn('[submitWorkflowEventAction] No workflows attached to event type', {
          eventType: event_type
        });
        
        return {
          message: `Event published, but no workflows are attached to event type: ${event_type}`,
          status: 'accepted'
        };
      }
      
      // Return success
      logger.info('[submitWorkflowEventAction] Event successfully published to attached workflows', {
        workflowCount: workflowAttachments.length,
        event_type
      });
      
      return {
        message: `Event published to ${workflowAttachments.length} attached workflow(s)`,
        status: 'accepted'
      };
    }
  } catch (error) {
    logger.error('[submitWorkflowEventAction] Error submitting workflow event:', error, {
      options,
      errorDetails: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : 'Unknown error format'
    });
    
    return {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: 'error'
    };
  }
}

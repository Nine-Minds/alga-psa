import { createWorkflowRuntime, EnqueueEventParams } from '../core/workflowRuntime';
import { startWorkflowWorker } from '../workers/workflowWorker';
import logger from '../../../utils/logger';

/**
 * Example of how to integrate with the asynchronous workflow API
 * This demonstrates the "fire and forget" pattern where events are enqueued
 * and processed asynchronously by workers
 */

// Create a workflow runtime instance
const workflowRuntime = createWorkflowRuntime();

/**
 * Initialize the workflow system with workers
 * This would typically be called during application startup
 */
export async function initializeWorkflowSystem(workerCount: number = 2): Promise<void> {
  logger.info(`Initializing workflow system with ${workerCount} workers`);
  
  // Start the specified number of workers
  for (let i = 0; i < workerCount; i++) {
    const worker = await startWorkflowWorker(workflowRuntime);
    logger.info(`Started workflow worker ${i + 1} with ID: ${worker['workerId']}`);
  }
  
  logger.info('Workflow system initialized');
}

/**
 * Trigger a workflow event asynchronously
 * This is a "fire and forget" operation that returns quickly
 */
export async function triggerWorkflowEventAsync(params: {
  executionId: string;
  eventName: string;
  payload?: Record<string, any>;
  tenant: string;
  userRole?: string;
}): Promise<{ success: boolean; eventId: string; message?: string }> {
  try {
    // Prepare event parameters
    const eventParams: EnqueueEventParams = {
      executionId: params.executionId,
      eventName: params.eventName,
      payload: params.payload,
      tenant: params.tenant,
      userRole: params.userRole,
      // Generate an idempotency key if needed for deduplication
      idempotencyKey: `${params.executionId}:${params.eventName}:${Date.now()}`
    };
    
    // Enqueue the event for asynchronous processing
    const result = await workflowRuntime.enqueueEvent(eventParams);
    
    if (!result.success) {
      logger.error(`Failed to enqueue workflow event: ${result.errorMessage}`);
      return {
        success: false,
        eventId: result.eventId,
        message: result.errorMessage
      };
    }
    
    logger.info(`Successfully enqueued workflow event ${result.eventId} for execution ${params.executionId}`);
    return {
      success: true,
      eventId: result.eventId
    };
  } catch (error: any) {
    logger.error('Error triggering workflow event:', error);
    return {
      success: false,
      eventId: '',
      message: error.message
    };
  }
}

/**
 * Create a new workflow execution and trigger its initial event asynchronously
 */
export async function createWorkflowAndTriggerAsync(params: {
  workflowName: string;
  initialEvent: string;
  payload?: Record<string, any>;
  tenant: string;
  userRole?: string;
}): Promise<{ success: boolean; executionId?: string; eventId?: string; message?: string }> {
  try {
    // Create a new workflow execution
    const executionId = await workflowRuntime.createExecution({
      workflowName: params.workflowName,
      tenant: params.tenant
    });
    
    // Trigger the initial event
    const eventResult = await triggerWorkflowEventAsync({
      executionId,
      eventName: params.initialEvent,
      payload: params.payload,
      tenant: params.tenant,
      userRole: params.userRole
    });
    
    if (!eventResult.success) {
      return {
        success: false,
        executionId,
        message: eventResult.message
      };
    }
    
    return {
      success: true,
      executionId,
      eventId: eventResult.eventId
    };
  } catch (error: any) {
    logger.error('Error creating workflow and triggering event:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Example usage in an invoice workflow
 */
export async function createInvoiceWorkflow(
  companyId: string,
  tenant: string,
  userId: string
): Promise<{ success: boolean; invoiceId?: string; message?: string }> {
  try {
    // Create a new invoice workflow and trigger the initial event
    const result = await createWorkflowAndTriggerAsync({
      workflowName: 'invoice_processing',
      initialEvent: 'create_invoice',
      payload: {
        companyId,
        createdBy: userId,
        createdAt: new Date().toISOString()
      },
      tenant,
      userRole: 'admin'
    });
    
    if (!result.success) {
      return {
        success: false,
        message: result.message
      };
    }
    
    // The executionId is used as the invoiceId in this example
    return {
      success: true,
      invoiceId: result.executionId
    };
  } catch (error: any) {
    logger.error('Error creating invoice workflow:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Example of approving an invoice asynchronously
 */
export async function approveInvoiceAsync(
  invoiceId: string,
  approvedBy: string,
  tenant: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Trigger the approve event on the invoice workflow
    const result = await triggerWorkflowEventAsync({
      executionId: invoiceId, // The executionId is the invoiceId
      eventName: 'approve_invoice',
      payload: {
        approvedBy,
        approvedAt: new Date().toISOString()
      },
      tenant,
      userRole: 'manager'
    });
    
    return {
      success: result.success,
      message: result.message
    };
  } catch (error: any) {
    logger.error('Error approving invoice:', error);
    return {
      success: false,
      message: error.message
    };
  }
}
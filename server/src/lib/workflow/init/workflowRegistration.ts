import { getWorkflowRuntime } from '../core/workflowRuntime';
import { getActionRegistry } from '../core/actionRegistry';
import { invoiceApprovalWorkflow } from '../examples/invoiceApprovalWorkflow';
import logger from '../../../utils/logger';

/**
 * Register all example workflows with the runtime
 * This function should be called during application startup
 */
export function registerExampleWorkflows(): void {
  try {
    // Get the action registry
    const actionRegistry = getActionRegistry();
    
    // Get the workflow runtime
    const runtime = getWorkflowRuntime(actionRegistry);
    
    // Register example workflows
    runtime.registerWorkflow(invoiceApprovalWorkflow);
    
    // Log successful registration
    logger.info('Example workflows registered successfully');
    
    // Get all registered workflows for verification
    const registeredWorkflows = runtime.getRegisteredWorkflows();
    logger.info(`Registered workflows: ${Array.from(registeredWorkflows.keys()).join(', ')}`);
  } catch (error) {
    logger.error('Failed to register example workflows:', error);
  }
}
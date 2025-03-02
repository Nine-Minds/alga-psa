import { getActionRegistry } from '../lib/workflow/core/actionRegistry';
import { getWorkflowRuntime } from '../lib/workflow/core/workflowRuntime';
import { getWorkflowWorkerService } from '../services/workflowWorkerService';
import { workflowConfig } from '../config/workflowConfig';
import logger from '../utils/logger';

/**
 * Initialize the workflow system
 * This function should be called during application startup
 */
export async function initializeWorkflowSystem(): Promise<void> {
  try {
    logger.info('[WorkflowInit] Initializing workflow system');
    
    // Initialize action registry
    const actionRegistry = getActionRegistry();
    
    // Initialize workflow runtime
    const workflowRuntime = getWorkflowRuntime(actionRegistry);
    
    // Start worker service if distributed mode is enabled
    if (workflowConfig.distributedMode) {
      logger.info('[WorkflowInit] Starting workflow worker service in distributed mode');
      const workerService = getWorkflowWorkerService();
      await workerService.start();
      logger.info('[WorkflowInit] Workflow worker service started successfully');
    } else {
      logger.info('[WorkflowInit] Distributed mode is disabled, not starting worker service');
    }
    
    logger.info('[WorkflowInit] Workflow system initialized successfully');
  } catch (error) {
    logger.error('[WorkflowInit] Failed to initialize workflow system:', error);
    throw error;
  }
}

/**
 * Shutdown the workflow system
 * This function should be called during application shutdown
 */
export async function shutdownWorkflowSystem(): Promise<void> {
  try {
    logger.info('[WorkflowInit] Shutting down workflow system');
    
    // Stop worker service if distributed mode is enabled
    if (workflowConfig.distributedMode) {
      logger.info('[WorkflowInit] Stopping workflow worker service');
      const workerService = getWorkflowWorkerService();
      await workerService.stop();
      logger.info('[WorkflowInit] Workflow worker service stopped successfully');
    }
    
    logger.info('[WorkflowInit] Workflow system shutdown successfully');
  } catch (error) {
    logger.error('[WorkflowInit] Failed to shutdown workflow system:', error);
    throw error;
  }
}
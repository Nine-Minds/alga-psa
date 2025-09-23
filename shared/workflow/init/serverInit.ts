/**
 * Server-side initialization for the workflow system
 * This file should only be imported in server components or server actions
 */

import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core/index';
import { registerExampleWorkflows } from '@alga-psa/shared/workflow/index';
import { logger } from '@alga-psa/shared/core';
import { registerWorkflowActions } from '@alga-psa/shared/workflow/index';

// Track initialization state
let initialized = false;

/**
 * Initialize the workflow system on the server side
 * This function is safe to call multiple times - it will only initialize once
 */
export async function initializeServerWorkflows(): Promise<void> {
  // Only initialize once
  if (initialized) {
    return;
  }
  
  try {
    logger.info('Initializing workflow system on server...');
    
    // Register all workflow actions
    const actionRegistry = registerWorkflowActions();
    
    // Initialize workflow runtime
    getWorkflowRuntime(actionRegistry);
    
    // Register example workflows
    registerExampleWorkflows();
    
    // Mark as initialized
    initialized = true;
    
    logger.info('Workflow system initialized successfully on server');
  } catch (error) {
    logger.error('Failed to initialize workflow system on server:', error);
    throw error;
  }
}

// Export a function to check if the system is initialized
export function isWorkflowSystemInitialized(): boolean {
  return initialized;
}

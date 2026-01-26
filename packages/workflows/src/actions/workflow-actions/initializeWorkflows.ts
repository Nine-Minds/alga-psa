'use server';

/**
 * Server-side initialization for the workflow system
 * This file is used to initialize the workflow system on the server side
 * for use with server actions like the workflow editor
 */

import { registerWorkflowActions } from '@shared/workflow/init/registerWorkflowActions';
import logger from '@alga-psa/core/logger';

// Track initialization state
let initialized = false;

/**
 * Initialize the workflow system on the server side for server actions
 * This function is safe to call multiple times - it will only initialize once
 */
export async function initializeServerWorkflowActions(): Promise<void> {
  // Only initialize once
  if (initialized) {
    return;
  }
  
  try {
    logger.info('Initializing workflow actions for server actions...');
    
    // Register all workflow actions
    registerWorkflowActions();
    
    // Mark as initialized
    initialized = true;
    
    logger.info('Workflow actions initialized successfully for server actions');
  } catch (error) {
    logger.error('Failed to initialize workflow actions for server actions:', error);
    throw error;
  }
}

// Export a function to check if the system is initialized
export async function isWorkflowActionsInitialized(): Promise<boolean> {
  return initialized;
}

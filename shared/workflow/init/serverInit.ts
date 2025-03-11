/**
 * Server-side initialization for the workflow system
 * This file should only be imported in server components or server actions
 */

import { getActionRegistry, getWorkflowRuntime, type ActionExecutionContext } from '@shared/workflow/core/index.js';
import { registerExampleWorkflows } from '@shared/workflow/init/index.js';
import logger from '@shared/core/logger.js';

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
    
    // Initialize action registry
    const actionRegistry = getActionRegistry();
    
    // Register common actions
    actionRegistry.registerSimpleAction(
      'log_audit_event',
      'Log an audit event',
      [
        { name: 'eventType', type: 'string', required: true },
        { name: 'entityId', type: 'string', required: true },
        { name: 'user', type: 'string', required: false }
      ],
      async (params: Record<string, any>, context: ActionExecutionContext) => {
        logger.info(`[AUDIT] ${params.eventType} for ${params.entityId} by ${params.user || 'system'}`);
        return { success: true };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'log_audit_message',
      'Log an audit message',
      [
        { name: 'message', type: 'string', required: true },
        { name: 'user', type: 'string', required: false }
      ],
      async (params: Record<string, any>, context: ActionExecutionContext) => {
        logger.info(`[AUDIT] ${params.message} ${params.user ? `by ${params.user}` : ''}`);
        return { success: true };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'send_notification',
      'Send a notification',
      [
        { name: 'recipient', type: 'string', required: true },
        { name: 'message', type: 'string', required: true }
      ],
      async (params: Record<string, any>, context: ActionExecutionContext) => {
        logger.info(`[NOTIFICATION] To: ${params.recipient}, Message: ${params.message}`);
        return { success: true, notificationId: `notif-${Date.now()}` };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'get_user_role',
      'Get user role',
      [
        { name: 'userId', type: 'string', required: true }
      ],
      async (params: Record<string, any>, context: ActionExecutionContext) => {
        // Mock implementation - in a real system, this would query a database
        const roles = {
          'user1': 'user',
          'user2': 'manager',
          'user3': 'senior_manager',
          'user4': 'admin'
        };
        
        const role = params.userId in roles 
          ? roles[params.userId as keyof typeof roles] 
          : 'user';
          
        return role;
      }
    );
    
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
/**
 * Shared module for registering workflow actions
 * This file contains all the action registration logic and can be called
 * from both the server and the workflow-worker
 */

import { getActionRegistry, type ActionRegistry, type ActionExecutionContext } from '@shared/workflow/core/index.js';
import logger from '@shared/core/logger.js';
import { getTaskInboxService } from '@shared/workflow/core/taskInboxService.js';

/**
 * Register all workflow actions with the action registry
 * @returns The action registry with all actions registered
 */
export function registerWorkflowActions(): ActionRegistry {
  // Get the action registry
  const actionRegistry = getActionRegistry();
  
  // Register common actions
  registerCommonActions(actionRegistry);
  
  // Register task inbox actions
  registerTaskInboxActions(actionRegistry);
  
  return actionRegistry;
}

/**
 * Register common workflow actions
 * @param actionRegistry The action registry to register with
 */
function registerCommonActions(actionRegistry: ActionRegistry): void {
  // Log audit event action
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
  
  // Log audit message action
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
  
  // Send notification action
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
  
  // Get user role action
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
}

/**
 * Register task inbox actions
 * @param actionRegistry The action registry to register with
 */
function registerTaskInboxActions(actionRegistry: ActionRegistry): void {
  const taskInboxService = getTaskInboxService();
  taskInboxService.registerTaskActions(actionRegistry);
}
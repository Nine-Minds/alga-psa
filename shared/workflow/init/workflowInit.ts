import { getActionRegistry } from '../core/actionRegistry';
import { getWorkflowRuntime } from '../core/workflowRuntime';
import logger from '@alga-psa/core/logger';

/**
 * Initialize the workflow system
 * This function should be called during application startup
 */
export async function initializeWorkflowSystem(): Promise<void> {
  try {
    logger.info('Initializing workflow system...');

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
      async (params) => {
        logger.info(`[AUDIT] ${params.eventType} for ${params.entityId} by ${params.user || 'system'}`);
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
      async (params) => {
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
      async (params) => {
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


    logger.info('Workflow system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize workflow system:', error);
    throw error;
  }
}

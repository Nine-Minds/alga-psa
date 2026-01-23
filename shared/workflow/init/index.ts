import { getActionRegistry, getWorkflowRuntime } from '@alga-psa/shared/workflow/core/index';
import { logger } from '@alga-psa/core';

export * from './serverInit';

// Export workflow action registration function
export { registerWorkflowActions } from './registerWorkflowActions';

/**
 * Register example workflows for testing and demonstration
 */
export function registerExampleWorkflows(): void {
  try {
    const actionRegistry = getActionRegistry();
    const runtime = getWorkflowRuntime(actionRegistry);

    // Example approval workflow
    runtime.registerWorkflow({
      metadata: {
        name: 'approval_workflow',
        description: 'A simple approval workflow example',
        version: '1.0.0',
        tags: ['example', 'approval']
      },
      execute: async (context) => {
        // Initial state
        context.setState('pending_approval');
        
        // Wait for approval event
        const event = await context.events.waitFor('approve');
        
        // Update state based on approval
        if (event.payload.approved) {
          context.setState('approved');
          await context.actions.log_audit_event({
            eventType: 'workflow_approved',
            entityId: context.executionId,
            user: event.user_id
          });
        } else {
          context.setState('rejected');
          await context.actions.log_audit_event({
            eventType: 'workflow_rejected',
            entityId: context.executionId,
            user: event.user_id
          });
        }
      }
    });

    logger.info('Example workflows registered successfully');
  } catch (error) {
    logger.error('Failed to register example workflows:', error);
    throw error;
  }
}

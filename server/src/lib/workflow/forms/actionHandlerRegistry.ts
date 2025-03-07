/**
 * Action Handler Registry for Workflow Forms
 * 
 * This module provides a registry for action handlers that can be used with workflow forms.
 * Action handlers define the business logic that should be executed when a form action is triggered.
 */

import { z } from 'zod';

/**
 * Action definition schema
 */
export const ActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  primary: z.boolean().optional().default(false),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link', 'soft']).optional().default('default'),
  icon: z.string().optional(),
  disabled: z.boolean().optional().default(false),
  hidden: z.boolean().optional().default(false),
  confirmationMessage: z.string().optional(),
  order: z.number().optional().default(0),
  className: z.string().optional(),
});

/**
 * Action definition type
 */
export type Action = z.infer<typeof ActionSchema>;

/**
 * Context provided to action handlers
 */
export interface ActionHandlerContext {
  formData: Record<string, any>;
  taskId?: string;
  executionId?: string;
  contextData?: Record<string, any>;
  userId?: string;
  tenant?: string;
}

/**
 * Action handler function type
 */
export type ActionHandler = (
  action: Action,
  context: ActionHandlerContext
) => Promise<ActionHandlerResult>;

/**
 * Action handler result
 */
export interface ActionHandlerResult {
  success: boolean;
  message?: string;
  data?: Record<string, any>;
  redirect?: string;
  closeForm?: boolean;
}

/**
 * Action handler registry
 */
class ActionHandlerRegistry {
  private handlers: Map<string, ActionHandler> = new Map();

  /**
   * Register an action handler
   * @param actionId The action ID
   * @param handler The action handler function
   */
  register(actionId: string, handler: ActionHandler): void {
    this.handlers.set(actionId, handler);
  }

  /**
   * Get an action handler
   * @param actionId The action ID
   * @returns The action handler function or undefined if not found
   */
  getHandler(actionId: string): ActionHandler | undefined {
    return this.handlers.get(actionId);
  }

  /**
   * Check if an action handler exists
   * @param actionId The action ID
   * @returns True if the handler exists, false otherwise
   */
  hasHandler(actionId: string): boolean {
    return this.handlers.has(actionId);
  }

  /**
   * Execute an action handler
   * @param action The action to execute
   * @param context The action context
   * @returns The action handler result
   * @throws Error if the action handler is not found
   */
  async executeAction(
    action: Action,
    context: ActionHandlerContext
  ): Promise<ActionHandlerResult> {
    const handler = this.getHandler(action.id);
    
    if (!handler) {
      throw new Error(`Action handler not found for action: ${action.id}`);
    }
    
    return handler(action, context);
  }
}

// Create a singleton instance of the registry
export const actionHandlerRegistry = new ActionHandlerRegistry();

/**
 * Register default action handlers
 */

// Submit action handler
actionHandlerRegistry.register('submit', async (action, context) => {
  // This is a placeholder. In a real implementation, this would be replaced
  // with the actual form submission logic.
  console.log('Submit action handler called with:', { action, context });
  
  return {
    success: true,
    message: 'Form submitted successfully',
    closeForm: true,
  };
});

// Cancel action handler
actionHandlerRegistry.register('cancel', async (action, context) => {
  console.log('Cancel action handler called with:', { action, context });
  
  return {
    success: true,
    closeForm: true,
  };
});

// Save draft action handler
actionHandlerRegistry.register('save_draft', async (action, context) => {
  console.log('Save draft action handler called with:', { action, context });
  
  return {
    success: true,
    message: 'Draft saved successfully',
  };
});
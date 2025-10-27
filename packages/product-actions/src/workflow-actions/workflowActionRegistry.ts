'use server';

import { getActionRegistry } from '@shared/workflow/core/actionRegistry';
import { ActionDefinition, ActionParameterDefinition } from '@shared/workflow/core/actionRegistry';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { initializeServerWorkflowActions } from './initializeWorkflows';

/**
 * Serializable version of action definition without the execute function
 */
interface SerializableActionDefinition {
  name: string;
  description: string;
  parameters: ActionParameterDefinition[];
}

/**
 * Server action to get all registered workflow actions in a serializable format
 * @returns Record of action names to serializable action definitions
 */
export async function getRegisteredWorkflowActions(): Promise<Record<string, SerializableActionDefinition>> {
  try {
    // Initialize workflow actions if not already initialized
    await initializeServerWorkflowActions();
    // Verify user is authenticated (optional, depending on your security requirements)
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }
    
    // Get action registry
    const actionRegistry = getActionRegistry();
    const registeredActions = actionRegistry.getRegisteredActions();
    
    // Convert to serializable format (without execute functions)
    const serializableActions: Record<string, SerializableActionDefinition> = {};
    
    for (const [name, action] of Object.entries(registeredActions)) {
      serializableActions[name] = {
        name: action.name,
        description: action.description,
        parameters: action.parameters
      };
    }
    
    return serializableActions;
  } catch (error) {
    console.error('Error fetching workflow actions:', error);
    throw error;
  }
}
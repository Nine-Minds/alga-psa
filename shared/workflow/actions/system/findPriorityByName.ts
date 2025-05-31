/**
 * Find priority by name
 * This action searches for existing priorities by name
 */

import { WorkflowAction } from '../../core/workflowContext';

export interface FindPriorityByNameInput {
  name: string;
}

export interface FindPriorityByNameOutput {
  id: string;
  name: string;
  description: string;
  order_index: number;
  is_default: boolean;
}

export const findPriorityByName: WorkflowAction<FindPriorityByNameInput, FindPriorityByNameOutput | null> = {
  name: 'find_priority_by_name',
  description: 'Find existing priority by name',
  
  async execute(input: FindPriorityByNameInput, context: any): Promise<FindPriorityByNameOutput | null> {
    const { logger } = context;
    
    try {
      logger.info(`Searching for priority: ${input.name}`);
      
      // TODO: Implement actual database query
      console.log(`[MOCK] Searching for priority with name: ${input.name}`);
      
      // Mock query structure would be:
      // SELECT id, name, description, order_index, is_default
      // FROM priorities
      // WHERE tenant = ? AND LOWER(name) = LOWER(?)
      
      // For demonstration, return mock results for common priorities
      const priorities = {
        'low': {
          id: 'priority-low-123',
          name: 'Low',
          description: 'Low priority items',
          order_index: 1,
          is_default: false
        },
        'medium': {
          id: 'priority-medium-123',
          name: 'Medium',
          description: 'Medium priority items',
          order_index: 2,
          is_default: true
        },
        'high': {
          id: 'priority-high-123',
          name: 'High',
          description: 'High priority items',
          order_index: 3,
          is_default: false
        },
        'urgent': {
          id: 'priority-urgent-123',
          name: 'Urgent',
          description: 'Urgent priority items',
          order_index: 4,
          is_default: false
        }
      };
      
      const priorityKey = input.name.toLowerCase() as keyof typeof priorities;
      if (priorities[priorityKey]) {
        return priorities[priorityKey];
      }
      
      // Return null if no priority found
      return null;
      
    } catch (error: any) {
      logger.error(`Error finding priority by name: ${error.message}`);
      return null;
    }
  }
};
/**
 * Find status by name and item type
 * This action searches for existing statuses by name and type
 */

import { WorkflowAction } from '../../types/workflowActionTypes';

export interface FindStatusByNameInput {
  name: string;
  item_type: string; // 'ticket', 'project', etc.
}

export interface FindStatusByNameOutput {
  id: string;
  name: string;
  item_type: string;
  is_closed: boolean;
  is_default: boolean;
  order_index: number;
}

export const findStatusByName: WorkflowAction<FindStatusByNameInput, FindStatusByNameOutput | null> = {
  name: 'find_status_by_name',
  description: 'Find existing status by name and item type',
  
  async execute(input: FindStatusByNameInput, context: any): Promise<FindStatusByNameOutput | null> {
    const { logger } = context;
    
    try {
      logger.info(`Searching for status: ${input.name} (${input.item_type})`);
      
      // TODO: Implement actual database query
      console.log(`[MOCK] Searching for status:`, {
        name: input.name,
        item_type: input.item_type
      });
      
      // Mock query structure would be:
      // SELECT s.id, s.name, s.item_type, s.is_closed, s.is_default, s.order_index
      // FROM statuses s
      // WHERE s.tenant = ? AND LOWER(s.name) = LOWER(?) AND s.item_type = ?
      
      // For demonstration, return mock results for common statuses
      if (input.name.toLowerCase() === 'new' && input.item_type === 'ticket') {
        return {
          id: 'status-new-123',
          name: 'New',
          item_type: 'ticket',
          is_closed: false,
          is_default: true,
          order_index: 1
        };
      }
      
      if (input.name.toLowerCase() === 'open' && input.item_type === 'ticket') {
        return {
          id: 'status-open-123',
          name: 'Open',
          item_type: 'ticket',
          is_closed: false,
          is_default: false,
          order_index: 2
        };
      }
      
      // Return null if no status found
      return null;
      
    } catch (error: any) {
      logger.error(`Error finding status by name: ${error.message}`);
      return null;
    }
  }
};
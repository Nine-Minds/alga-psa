import { BaseModel } from './BaseModel';
import type { Knex } from 'knex';
import { 
  IWorkflowEventMapping, 
  ICreateWorkflowEventMapping, 
  IUpdateWorkflowEventMapping 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for workflow event mappings
 */
export class WorkflowEventMappingModel extends BaseModel {
  /**
   * Create a new workflow event mapping
   * 
   * @param knex Knex instance
   * @param data Workflow event mapping data
   * @returns The created workflow event mapping
   */
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    data: ICreateWorkflowEventMapping
  ): Promise<IWorkflowEventMapping> {
    const [mapping] = await knexOrTrx('workflow_event_mappings')
      .insert({
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return mapping;
  }

  /**
   * Get a workflow event mapping by ID
   * 
   * @param knex Knex instance
   * @param mappingId Mapping ID
   * @returns The workflow event mapping or null if not found
   */
  static async getById(
    knexOrTrx: Knex | Knex.Transaction,
    mappingId: string
  ): Promise<IWorkflowEventMapping | null> {
    const mapping = await knexOrTrx('workflow_event_mappings')
      .where('mapping_id', mappingId)
      .first();
    
    return mapping || null;
  }

  /**
   * Get all workflow event mappings for a trigger
   * 
   * @param knex Knex instance
   * @param triggerId Trigger ID
   * @returns Array of workflow event mappings
   */
  static async getAllForTrigger(
    knexOrTrx: Knex | Knex.Transaction,
    triggerId: string
  ): Promise<IWorkflowEventMapping[]> {
    const mappings = await knexOrTrx('workflow_event_mappings')
      .where('trigger_id', triggerId)
      .orderBy('created_at', 'asc');
    
    return mappings;
  }

  /**
   * Update a workflow event mapping
   * 
   * @param knex Knex instance
   * @param mappingId Mapping ID
   * @param data Update data
   * @returns The updated workflow event mapping
   */
  static async update(
    knexOrTrx: Knex | Knex.Transaction,
    mappingId: string,
    data: IUpdateWorkflowEventMapping
  ): Promise<IWorkflowEventMapping | null> {
    const [mapping] = await knexOrTrx('workflow_event_mappings')
      .where('mapping_id', mappingId)
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return mapping || null;
  }

  /**
   * Delete a workflow event mapping
   * 
   * @param knex Knex instance
   * @param mappingId Mapping ID
   * @returns True if the mapping was deleted, false otherwise
   */
  static async delete(
    knexOrTrx: Knex | Knex.Transaction,
    mappingId: string
  ): Promise<boolean> {
    const result = await knexOrTrx('workflow_event_mappings')
      .where('mapping_id', mappingId)
      .delete();
    
    return result !== 0;
  }

  /**
   * Delete all workflow event mappings for a trigger
   * 
   * @param knex Knex instance
   * @param triggerId Trigger ID
   * @returns Number of mappings deleted
   */
  static async deleteAllForTrigger(
    knexOrTrx: Knex | Knex.Transaction,
    triggerId: string
  ): Promise<number> {
    const result = await knexOrTrx('workflow_event_mappings')
      .where('trigger_id', triggerId)
      .delete();
    
    return result as number;
  }

  /**
   * Create multiple workflow event mappings in a transaction
   * 
   * @param knex Knex instance
   * @param mappings Array of workflow event mapping data
   * @returns Array of created workflow event mappings
   */
  static async createMany(
    knexOrTrx: Knex | Knex.Transaction,
    mappings: ICreateWorkflowEventMapping[]
  ): Promise<IWorkflowEventMapping[]> {
    if (mappings.length === 0) {
      return [];
    }

    const createdMappings = await knexOrTrx.transaction(async (trx) => {
      const results: any[] = [];
      const now = new Date().toISOString();
      
      for (const mapping of mappings) {
        const [result] = await trx('workflow_event_mappings')
          .insert({
            ...mapping,
            created_at: now,
            updated_at: now
          })
          .returning('*');
        
        results.push(result);
      }
      
      return results;
    });
    
    return createdMappings;
  }
}

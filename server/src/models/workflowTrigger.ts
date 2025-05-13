import { Knex } from 'knex';
import { 
  IWorkflowTrigger, 
  ICreateWorkflowTrigger, 
  IUpdateWorkflowTrigger 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for workflow triggers
 */
export class WorkflowTriggerModel {
  /**
   * Create a new workflow trigger
   * 
   * @param knex Knex instance
   * @param data Workflow trigger data
   * @returns The created workflow trigger
   */
  static async create(
    knex: Knex,
    data: ICreateWorkflowTrigger
  ): Promise<IWorkflowTrigger> {
    const [trigger] = await knex('workflow_triggers')
      .insert({
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return trigger;
  }

  /**
   * Get a workflow trigger by ID
   * 
   * @param knex Knex instance
   * @param triggerId Trigger ID
   * @param tenantId Tenant ID
   * @returns The workflow trigger or null if not found
   */
  static async getById(
    knex: Knex,
    triggerId: string,
    tenantId: string
  ): Promise<IWorkflowTrigger | null> {
    const trigger = await knex('workflow_triggers')
      .where({
        trigger_id: triggerId,
        tenant: tenantId
      })
      .first();
    
    return trigger || null;
  }

  /**
   * Get all workflow triggers for a tenant
   * 
   * @param knex Knex instance
   * @param tenantId Tenant ID
   * @param options Query options
   * @returns Array of workflow triggers
   */
  static async getAll(
    knex: Knex,
    tenantId: string,
    options: {
      eventType?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<IWorkflowTrigger[]> {
    const { eventType, limit = 100, offset = 0 } = options;
    
    const query = knex('workflow_triggers')
      .where('tenant', tenantId);
    
    if (eventType !== undefined) {
      query.where('event_type', eventType);
    }
    
    const triggers = await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);
    
    return triggers;
  }

  /**
   * Update a workflow trigger
   * 
   * @param knex Knex instance
   * @param triggerId Trigger ID
   * @param tenantId Tenant ID
   * @param data Update data
   * @returns The updated workflow trigger
   */
  static async update(
    knex: Knex,
    triggerId: string,
    tenantId: string,
    data: IUpdateWorkflowTrigger
  ): Promise<IWorkflowTrigger | null> {
    const [trigger] = await knex('workflow_triggers')
      .where({
        trigger_id: triggerId,
        tenant: tenantId
      })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return trigger || null;
  }

  /**
   * Delete a workflow trigger
   * 
   * @param knex Knex instance
   * @param triggerId Trigger ID
   * @param tenantId Tenant ID
   * @returns True if the trigger was deleted, false otherwise
   */
  static async delete(
    knex: Knex,
    triggerId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await knex('workflow_triggers')
      .where({
        trigger_id: triggerId,
        tenant: tenantId
      })
      .delete();
    
    return result !== 0;
  }
}

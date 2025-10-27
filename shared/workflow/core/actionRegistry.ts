/**
 * Action parameter definition
 */
export interface ActionParameterDefinition {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  description?: string;
}

/**
 * Action execution context
 */
export interface ActionExecutionContext {
  tenant: string;
  executionId: string;
  eventId?: string;
  idempotencyKey: string;
  parameters: Record<string, any>;
  userId?: string; // Added userId field which may be present in some contexts
  secrets?: Record<string, any>; // Optional field for injected secrets
  workflowName?: string; // Added for logging context
  correlationId?: string; // Added for logging context and potential future use
  knex?: any; // Optional Knex connection/transaction - when provided, avoids cross-shard FK issues
}

/**
 * Action execution function
 */
export type ActionExecutionFunction = (
  params: Record<string, any>,
  context: ActionExecutionContext
) => Promise<any>;

/**
 * Action definition
 */
export interface ActionDefinition {
  name: string;
  description: string;
  parameters: ActionParameterDefinition[];
  execute: ActionExecutionFunction;
}

/**
 * Transaction isolation level for database actions
 */
export enum TransactionIsolationLevel {
  READ_UNCOMMITTED = 'READ UNCOMMITTED',
  READ_COMMITTED = 'READ COMMITTED',
  REPEATABLE_READ = 'REPEATABLE READ',
  SERIALIZABLE = 'SERIALIZABLE'
}

/**
 * Registry for workflow actions
 */
export class ActionRegistry {
  private actions: Map<string, ActionDefinition> = new Map();
  
  /**
   * Register a simple action
   */
  registerSimpleAction(
    name: string,
    description: string,
    parameters: ActionParameterDefinition[],
    executeFn: ActionExecutionFunction
  ): void {
    this.actions.set(name, {
      name,
      description,
      parameters,
      execute: executeFn
    });
  }
  
  /**
   * Register a database action with transaction support
   */
  registerDatabaseAction(
    name: string,
    description: string,
    parameters: ActionParameterDefinition[],
    isolationLevel: TransactionIsolationLevel,
    executeFn: (params: Record<string, any>, context: any) => Promise<any>
  ): void {
    this.actions.set(name, {
      name,
      description,
      parameters,
      execute: async (params, context) => {
        // In a real implementation, this would create a database transaction
        // with the specified isolation level
        const txContext = {
          ...context,
          transaction: (table: string) => ({
            where: (column: string, value: any) => ({
              update: (data: any) => Promise.resolve(1)
            })
          })
        };
        
        return executeFn(params, txContext);
      }
    });
  }
  
  /**
   * Execute an action
   */
  async executeAction(
    actionName: string,
    context: ActionExecutionContext
  ): Promise<any> {
    const action = this.actions.get(actionName);
    if (!action) {
      throw new Error(`Action "${actionName}" not found`);
    }
    
    // Validate parameters
    this.validateParameters(action, context.parameters);
    
    // Log action execution for debugging
    console.log(`[ActionRegistry] Executing action "${actionName}" for execution ${context.executionId} with idempotency key ${context.idempotencyKey}`, { 
      tenant: context.tenant,
      eventId: context.eventId,
      parameterKeys: Object.keys(context.parameters)
    });
    
    let knex: any;
    try {
      // Import models here to avoid circular dependencies
      const { default: WorkflowActionResultModel } = await import('../persistence/workflowActionResultModel');

      // Use provided connection if available, otherwise get a fresh one
      // Using the same connection avoids Citus cross-shard FK timing issues
      if (context.knex) {
        knex = context.knex;
      } else {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        knex = await getAdminConnection();
      }
      
      // Create action result record (pre-execution)
      let resultId;
      try {
        // Import uuid for generating missing event_id
        const { v4: uuidv4 } = await import('uuid');
        
        // Ensure event_id is a valid UUID - generate one if missing
        const eventId = context.eventId && context.eventId.trim() ? context.eventId : uuidv4();
        
        const createResult = await WorkflowActionResultModel.create(knex, context.tenant, {
          execution_id: context.executionId,
          event_id: eventId,
          action_name: actionName,
          idempotency_key: context.idempotencyKey,
          ready_to_execute: true,
          success: false,
          parameters: context.parameters,
          tenant: context.tenant
        });
        
        resultId = createResult.result_id;
        // console.log(`[ActionRegistry] Created action result record with ID ${resultId}`);
        
        // Mark as started
        await WorkflowActionResultModel.markAsStarted(knex, context.tenant, resultId);
      } catch (dbError) {
        console.error(`[ActionRegistry] Error creating action result record:`, dbError);
        // Continue execution even if recording fails
      }
      
      // Execute action
      try {
        const result = await action.execute(context.parameters, context);
        // console.log(`[ActionRegistry] Action "${actionName}" executed successfully`);
        
        // Mark as completed successfully if we have a resultId
        if (resultId) {
          try {
            await WorkflowActionResultModel.markAsCompleted(
              knex, 
              context.tenant, 
              resultId, 
              true, 
              result
            );
            // console.log(`[ActionRegistry] Updated action result record ${resultId} as completed successfully`);
          } catch (dbError) {
            // console.error(`[ActionRegistry] Error updating action result record:`, dbError);
            throw dbError;  
          }
        }
        
        return result;
      } catch (error) {
        console.error(`[ActionRegistry] Error executing action "${actionName}":`, error);
        
        // Mark as failed if we have a resultId
        if (resultId) {
          try {
            await WorkflowActionResultModel.markAsCompleted(
              knex, 
              context.tenant, 
              resultId, 
              false, 
              undefined, 
              error instanceof Error ? error.message : String(error)
            );
            console.log(`[ActionRegistry] Updated action result record ${resultId} as failed`);
          } catch (dbError) {
            console.error(`[ActionRegistry] Error updating action result record:`, dbError);
          }
        }
        
        throw error;
      }
    } catch (error) {
      console.error(`[ActionRegistry] Error in action execution process:`, error);
      throw error;
    }
  }
  
  /**
   * Get all registered actions
   */
  getRegisteredActions(): Record<string, ActionDefinition> {
    const result: Record<string, ActionDefinition> = {};
    for (const [name, action] of this.actions.entries()) {
      result[name] = action;
    }
    return result;
  }
  
  /**
   * Validate action parameters
   */
  private validateParameters(
    action: ActionDefinition,
    params: Record<string, any>
  ): void {
    for (const paramDef of action.parameters) {
      if (paramDef.required && !(paramDef.name in params) && paramDef.defaultValue === undefined) {
        throw new Error(`Required parameter "${paramDef.name}" missing for action "${action.name}"`);
      }
    }
  }
}

// Singleton instance
let registryInstance: ActionRegistry | null = null;

/**
 * Get the action registry instance
 */
export function getActionRegistry(): ActionRegistry {
  if (!registryInstance) {
    registryInstance = new ActionRegistry();
  }
  return registryInstance;
}

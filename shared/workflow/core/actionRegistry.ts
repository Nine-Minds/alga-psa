import type { Knex } from 'knex';

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
  transaction?: Knex.Transaction; // Optional active transaction for database actions
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
    _isolationLevel: TransactionIsolationLevel,
    executeFn: (params: Record<string, any>, context: any) => Promise<any>
  ): void {
    this.actions.set(name, {
      name,
      description,
      parameters,
      execute: async (params, context) => {
        const transaction = context.transaction;
        if (!transaction) {
          throw new Error('Transaction required for database action');
        }

        return executeFn(params, {
          ...context,
          transaction
        });
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
  
    // Import heavy dependencies lazily to avoid circular references
    const { default: WorkflowActionResultModel } = await import('../persistence/workflowActionResultModel');
    const { withAdminTransaction } = await import('@alga-psa/shared/db/index');
    const { v4: uuidv4 } = await import('uuid');

    return await withAdminTransaction(async (trx) => {
      // Make sure downstream consumers see the active transaction
      const executionContext: ActionExecutionContext = {
        ...context,
        transaction: trx
      };

      let resultId: string | null = null;

      try {
        const eventId = executionContext.eventId && executionContext.eventId.trim()
          ? executionContext.eventId
          : uuidv4();

        const createResult = await WorkflowActionResultModel.create(trx, executionContext.tenant, {
          execution_id: executionContext.executionId,
          event_id: eventId,
          action_name: actionName,
          idempotency_key: executionContext.idempotencyKey,
          ready_to_execute: true,
          success: false,
          parameters: executionContext.parameters,
          tenant: executionContext.tenant
        });

        resultId = createResult.result_id;

        await WorkflowActionResultModel.markAsStarted(trx, executionContext.tenant, resultId);
      } catch (dbError) {
        console.error(`[ActionRegistry] Error creating action result record:`, dbError);
      }

      try {
        const result = await action.execute(executionContext.parameters, executionContext);

        if (resultId) {
          try {
            await WorkflowActionResultModel.markAsCompleted(
              trx,
              executionContext.tenant,
              resultId,
              true,
              result
            );
          } catch (dbError) {
            console.error(`[ActionRegistry] Error updating action result record:`, dbError);
            throw dbError;
          }
        }

        return result;
      } catch (error) {
        console.error(`[ActionRegistry] Error executing action "${actionName}":`, error);

        if (resultId) {
          try {
            await WorkflowActionResultModel.markAsCompleted(
              trx,
              executionContext.tenant,
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
    }, context.transaction);
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

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
    
    // Execute action
    return action.execute(context.parameters, context);
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

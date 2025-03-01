import { createTenantKnex } from '@/lib/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import WorkflowActionResultModel from '../persistence/workflowActionResultModel';

/**
 * Defines the transaction isolation level for action execution
 */
export enum TransactionIsolationLevel {
  READ_UNCOMMITTED = 'read uncommitted',
  READ_COMMITTED = 'read committed',
  REPEATABLE_READ = 'repeatable read',
  SERIALIZABLE = 'serializable'
}

/**
 * Interface for action parameter validation schema
 */
export interface ActionParameterSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  defaultValue?: any;
  validation?: RegExp | ((value: any) => boolean);
}

/**
 * Interface for action metadata
 */
export interface ActionMetadata {
  name: string;
  description: string;
  category?: string;
  parameters: ActionParameterSchema[];
  requiresTransaction?: boolean;
  isolationLevel?: TransactionIsolationLevel;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Context passed to action handlers during execution
 */
export interface ActionContext {
  tenant: string;
  executionId: string;
  eventId: string;
  transaction?: Knex.Transaction;
  idempotencyKey: string;
  retryCount?: number;
}

/**
 * Result of action execution
 */
export interface ActionExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  transactionCommitted?: boolean;
}

/**
 * Function type for action handlers
 */
export type ActionHandler = (parameters: Record<string, any>, context: ActionContext) => Promise<ActionExecutionResult>;

/**
 * Registry entry for an action
 */
interface ActionRegistryEntry {
  metadata: ActionMetadata;
  handler: ActionHandler;
}

/**
 * Options for executing an action
 */
export interface ActionExecutionOptions {
  tenant: string;
  executionId: string;
  eventId: string;
  idempotencyKey: string;
  parameters: Record<string, any>;
  useTransaction?: boolean;
  isolationLevel?: TransactionIsolationLevel;
  retryCount?: number;
}

/**
 * Main ActionRegistry class that manages registration and execution of actions
 */
export class ActionRegistry {
  private actions: Map<string, ActionRegistryEntry> = new Map();

  /**
   * Register an action with the registry
   * @param metadata Metadata describing the action
   * @param handler Handler function that implements the action
   */
  registerAction(metadata: ActionMetadata, handler: ActionHandler): void {
    if (this.actions.has(metadata.name)) {
      throw new Error(`Action with name ${metadata.name} is already registered`);
    }

    this.actions.set(metadata.name, { metadata, handler });
  }

  /**
   * Get an action's metadata by name
   * @param actionName Name of the action
   * @returns The action's metadata or undefined if not found
   */
  getActionMetadata(actionName: string): ActionMetadata | undefined {
    return this.actions.get(actionName)?.metadata;
  }

  /**
   * Get all registered actions
   * @returns Array of all action metadata
   */
  getAllActions(): ActionMetadata[] {
    return Array.from(this.actions.values()).map(entry => entry.metadata);
  }

  /**
   * Get all registered actions in a specific category
   * @param category Category name
   * @returns Array of action metadata in the specified category
   */
  getActionsByCategory(category: string): ActionMetadata[] {
    return Array.from(this.actions.values())
      .filter(entry => entry.metadata.category === category)
      .map(entry => entry.metadata);
  }

  /**
   * Validate parameters against action's parameter schema
   * @param actionName Name of the action
   * @param parameters Parameters to validate
   * @returns Validated and processed parameters
   * @throws Error if parameters are invalid
   */
  private validateParameters(actionName: string, parameters: Record<string, any>): Record<string, any> {
    const action = this.actions.get(actionName);
    if (!action) {
      throw new Error(`Action ${actionName} not found`);
    }

    const result: Record<string, any> = {};
    const { metadata } = action;

    // Check each parameter defined in the schema
    for (const paramSchema of metadata.parameters) {
      const { name, type, required, defaultValue, validation } = paramSchema;
      let value = parameters[name];

      // Check if required parameter is missing
      if (required && (value === undefined || value === null)) {
        if (defaultValue !== undefined) {
          value = defaultValue;
        } else {
          throw new Error(`Required parameter ${name} is missing for action ${actionName}`);
        }
      }

      // If value is provided, validate its type
      if (value !== undefined) {
        // Type validation
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== type && !(type === 'object' && actualType === 'object')) {
          throw new Error(`Parameter ${name} for action ${actionName} should be of type ${type}, but got ${actualType}`);
        }

        // Custom validation if provided
        if (validation) {
          const valid = validation instanceof RegExp
            ? validation.test(String(value))
            : validation(value);

          if (!valid) {
            throw new Error(`Parameter ${name} for action ${actionName} failed validation`);
          }
        }

        result[name] = value;
      } else if (defaultValue !== undefined) {
        // Use default value if provided and value is undefined
        result[name] = defaultValue;
      }
    }

    return result;
  }

  /**
   * Execute an action with idempotency and transaction support
   * @param actionName Name of the action to execute
   * @param options Options for action execution
   * @returns Result of action execution
   */
  async executeAction(
    actionName: string,
    options: ActionExecutionOptions
  ): Promise<ActionExecutionResult> {
    const actionEntry = this.actions.get(actionName);
    if (!actionEntry) {
      return {
        success: false,
        error: `Action ${actionName} not found`
      };
    }

    // Check for existing execution result (idempotency)
    try {
      const existingResult = await WorkflowActionResultModel.getByIdempotencyKey(options.idempotencyKey);
      if (existingResult) {
        console.log(`Action already executed: ${actionName}, idempotencyKey=${options.idempotencyKey}, returning stored result`);
        return {
          success: existingResult.success,
          result: existingResult.result,
          error: existingResult.error_message
        };
      }
    } catch (error) {
      console.error(`Error checking idempotency for action ${actionName}:`, error);
      // Continue with execution, as this is just a failed check, not a failed action
    }

    // Determine if we need a transaction
    const useTransaction = options.useTransaction ?? actionEntry.metadata.requiresTransaction ?? false;
    const isolationLevel = options.isolationLevel || actionEntry.metadata.isolationLevel || TransactionIsolationLevel.READ_COMMITTED;

    // Create transaction if needed
    let transaction: Knex.Transaction | undefined;
    if (useTransaction) {
      try {
        // createTenantKnex doesn't accept tenant argument directly
        const { knex } = await createTenantKnex();
        transaction = await knex.transaction({
          isolationLevel
        });
      } catch (error) {
        console.error(`Error creating transaction for action ${actionName}:`, error);
        return {
          success: false,
          error: `Transaction initialization failed: ${(error as Error).message}`
        };
      }
    }

    try {
      // Create an action record before execution
      let resultId: string;
      if (transaction) {
        // Using transaction requires modifying how we insert the record
        const [insertedId] = await transaction('workflow_action_results')
          .insert({
            tenant: options.tenant,
            event_id: options.eventId,
            execution_id: options.executionId,
            action_name: actionName,
            parameters: options.parameters,
            idempotency_key: options.idempotencyKey,
            success: false, // Will update after execution
            ready_to_execute: true,
            started_at: new Date().toISOString()
          })
          .returning('result_id');
        
        resultId = insertedId.result_id;
      } else {
        // Use the model's create function
        const result = await WorkflowActionResultModel.create({
          tenant: options.tenant,
          event_id: options.eventId,
          execution_id: options.executionId,
          action_name: actionName,
          parameters: options.parameters,
          idempotency_key: options.idempotencyKey,
          success: false, // Will update after execution
          ready_to_execute: true,
          started_at: new Date().toISOString()
        });
        
        resultId = result.result_id;
      }

      // Validate and process parameters
      const validatedParams = this.validateParameters(actionName, options.parameters);

      // Execute the action handler
      const context: ActionContext = {
        tenant: options.tenant,
        executionId: options.executionId,
        eventId: options.eventId,
        transaction,
        idempotencyKey: options.idempotencyKey,
        retryCount: options.retryCount
      };

      const actionResult = await actionEntry.handler(validatedParams, context);

      // Update the action result in the database
      if (transaction) {
        // Direct update using transaction since the model doesn't support transaction
        await transaction('workflow_action_results')
          .where({
            result_id: resultId,
            tenant: options.tenant
          })
          .update({
            success: actionResult.success,
            result: actionResult.result,
            error_message: actionResult.error,
            completed_at: new Date().toISOString()
          });

        // Commit the transaction if requested and not already committed
        if (actionResult.success && !actionResult.transactionCommitted) {
          await transaction.commit();
          actionResult.transactionCommitted = true;
        } else if (!actionResult.success && !actionResult.transactionCommitted) {
          await transaction.rollback();
        }
      } else {
        await WorkflowActionResultModel.markAsCompleted(
          resultId,
          actionResult.success,
          actionResult.result,
          actionResult.error
        );
      }

      return actionResult;
    } catch (error) {
      console.error(`Error executing action ${actionName}:`, error);

      // Rollback transaction if it exists and hasn't been committed or rolled back
      if (transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          console.error(`Error rolling back transaction for action ${actionName}:`, rollbackError);
        }
      }

      return {
        success: false,
        error: `Action execution failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Register a simple action that doesn't need transaction or complex logic
   * @param name Name of the action
   * @param description Description of the action
   * @param parameters Parameter schema for the action
   * @param handler Handler function for the action
   */
  registerSimpleAction(
    name: string,
    description: string,
    parameters: ActionParameterSchema[],
    handler: (params: Record<string, any>) => Promise<any>
  ): void {
    this.registerAction(
      {
        name,
        description,
        parameters
      },
      async (params, context) => {
        try {
          const result = await handler(params);
          return {
            success: true,
            result
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    );
  }

  /**
   * Register a database action that requires transaction support
   * @param name Name of the action
   * @param description Description of the action
   * @param parameters Parameter schema for the action
   * @param isolationLevel Transaction isolation level
   * @param handler Handler function for the action
   */
  registerDatabaseAction(
    name: string,
    description: string,
    parameters: ActionParameterSchema[],
    isolationLevel: TransactionIsolationLevel,
    handler: (params: Record<string, any>, context: ActionContext) => Promise<any>
  ): void {
    this.registerAction(
      {
        name,
        description,
        parameters,
        requiresTransaction: true,
        isolationLevel
      },
      async (params, context) => {
        if (!context.transaction) {
          return {
            success: false,
            error: `Database action ${name} requires a transaction`
          };
        }

        try {
          const result = await handler(params, context);
          return {
            success: true,
            result
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    );
  }
}

/**
 * Create and register built-in actions for common operations
 * @param registry The action registry to register actions with
 */
function registerBuiltInActions(registry: ActionRegistry): void {
  // Log an event
  registry.registerSimpleAction(
    'LogEvent',
    'Log an event for auditing purposes',
    [
      { name: 'eventType', type: 'string', required: true, description: 'Type of event to log' },
      { name: 'entityId', type: 'string', required: true, description: 'ID of the entity related to the event' },
      { name: 'details', type: 'object', required: false, description: 'Additional details to log' }
    ],
    async (params) => {
      console.log(`[AUDIT LOG] ${params.eventType} for ${params.entityId}: ${JSON.stringify(params.details || {})}`);
      return { logged: true, timestamp: new Date().toISOString() };
    }
  );

  // Send notification
  registry.registerSimpleAction(
    'SendNotification',
    'Send a notification to a recipient',
    [
      { name: 'recipient', type: 'string', required: true, description: 'Recipient of the notification' },
      { name: 'message', type: 'string', required: true, description: 'Message content' },
      { name: 'type', type: 'string', required: false, description: 'Notification type', defaultValue: 'info' }
    ],
    async (params) => {
      // This would integrate with a notification service in a real implementation
      console.log(`[NOTIFICATION] To: ${params.recipient}, Type: ${params.type}, Message: ${params.message}`);
      return { sent: true, timestamp: new Date().toISOString() };
    }
  );

  // Update database record
  registry.registerDatabaseAction(
    'UpdateDatabaseRecord',
    'Update a record in the database',
    [
      { name: 'table', type: 'string', required: true, description: 'Table name' },
      { name: 'id', type: 'string', required: true, description: 'Record ID' },
      { name: 'data', type: 'object', required: true, description: 'Data to update' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ,
    async (params, context) => {
      if (!context.transaction) {
        throw new Error('Transaction is required for database update');
      }

      const result = await context.transaction(params.table)
        .where('id', params.id)
        .update(params.data);

      return { updated: result === 1, affectedRows: result };
    }
  );

  // Create database record
  registry.registerDatabaseAction(
    'CreateDatabaseRecord',
    'Create a new record in the database',
    [
      { name: 'table', type: 'string', required: true, description: 'Table name' },
      { name: 'data', type: 'object', required: true, description: 'Data to insert' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ,
    async (params, context) => {
      if (!context.transaction) {
        throw new Error('Transaction is required for database insert');
      }

      const result = await context.transaction(params.table)
        .insert(params.data)
        .returning('id');

      return { created: true, id: result[0] };
    }
  );

  // Delete database record
  registry.registerDatabaseAction(
    'DeleteDatabaseRecord',
    'Delete a record from the database',
    [
      { name: 'table', type: 'string', required: true, description: 'Table name' },
      { name: 'id', type: 'string', required: true, description: 'Record ID' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ,
    async (params, context) => {
      if (!context.transaction) {
        throw new Error('Transaction is required for database delete');
      }

      const result = await context.transaction(params.table)
        .where('id', params.id)
        .delete();

      return { deleted: result === 1, affectedRows: result };
    }
  );

  // Wait for a duration (useful for testing and simulating delays)
  registry.registerSimpleAction(
    'Wait',
    'Wait for a specified duration',
    [
      { name: 'duration', type: 'number', required: true, description: 'Duration to wait in milliseconds' }
    ],
    async (params) => {
      await new Promise(resolve => setTimeout(resolve, params.duration));
      return { waited: true, duration: params.duration };
    }
  );
}

// Singleton instance of the action registry
let actionRegistryInstance: ActionRegistry | null = null;

/**
 * Get the action registry instance, creating it if it doesn't exist
 * @param initializeBuiltIns Whether to initialize built-in actions
 * @returns The action registry instance
 */
export function getActionRegistry(initializeBuiltIns: boolean = true): ActionRegistry {
  if (!actionRegistryInstance) {
    actionRegistryInstance = new ActionRegistry();
    if (initializeBuiltIns) {
      registerBuiltInActions(actionRegistryInstance);
    }
  }
  return actionRegistryInstance;
}

/**
 * Create a new action registry instance (primarily for testing)
 * @param initializeBuiltIns Whether to initialize built-in actions
 * @returns A new action registry instance
 */
export function createActionRegistry(initializeBuiltIns: boolean = true): ActionRegistry {
  const registry = new ActionRegistry();
  if (initializeBuiltIns) {
    registerBuiltInActions(registry);
  }
  return registry;
}
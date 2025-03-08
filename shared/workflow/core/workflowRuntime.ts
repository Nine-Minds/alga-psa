import { WorkflowContext, WorkflowFunction, WorkflowEvent } from './workflowContext.js';
import {
  WorkflowDefinition,
  deserializeWorkflowDefinition,
  SerializedWorkflowDefinition
} from './workflowDefinition.js';
import { ActionRegistry } from './actionRegistry.js';
import { WorkflowEventSourcing, EventReplayOptions } from './workflowEventSourcing.js';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getRedisStreamClient } from '@shared/workflow/streams/redisStreamClient.js';
import { executeDistributedTransaction } from '@shared/workflow/utils/distributedTransaction.js';
import { acquireDistributedLock, releaseDistributedLock } from '@shared/workflow/utils/distributedLock.js';
import { toStreamEvent } from '@shared/workflow/streams/workflowEventSchema.js';
import WorkflowEventModel from '@shared/workflow/persistence/workflowEventModel.js';
import WorkflowExecutionModel from '@shared/workflow/persistence/workflowExecutionModel.js';
import WorkflowEventProcessingModel from '@shared/workflow/persistence/workflowEventProcessingModel.js';
import logger from '@shared/core/logger.js';

// Temporary workflowConfig until the real one is implemented
const workflowConfig = {
  distributedMode: true
};

/**
 * Options for workflow execution
 */
export interface WorkflowExecutionOptions {
  tenant: string;
  initialData?: Record<string, any>;
  userId?: string;
}

/**
 * Result of a workflow execution
 */
export interface WorkflowExecutionResult {
  executionId: string;
  currentState: string;
  isComplete: boolean;
}

/**
 * Event submission options
 */
export interface EventSubmissionOptions {
  execution_id: string;
  event_name: string;
  payload?: any;
  user_id?: string;
  tenant: string;
  idempotency_key?: string;
}

/**
 * Result of enqueueing an event
 */
export interface EnqueueEventResult {
  eventId: string;
  processingId: string;
}

/**
 * Parameters for processing a queued event
 */
export interface ProcessQueuedEventParams {
  eventId: string;
  executionId: string;
  processingId: string;
  workerId: string;
  tenant: string;
}

/**
 * Result of processing a queued event
 */
export interface ProcessQueuedEventResult {
  success: boolean;
  errorMessage?: string;
  previousState?: string;
  currentState?: string;
  actionsExecuted: Array<{
    actionName: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Implementation of the workflow runtime for TypeScript-based workflows
 */
export interface TypeScriptWorkflowRuntime {
  loadExecutionState(
    knex: Knex,
    executionId: string,
    tenant: string,
    options?: EventReplayOptions
  ): Promise<any>;
  
  registerWorkflow(workflow: WorkflowDefinition): void;
  
  getRegisteredWorkflows(): Map<string, WorkflowDefinition>;
  
  getWorkflowDefinition(
    workflowName: string,
    version?: string
  ): Promise<WorkflowDefinition | null>;
  
  startWorkflow(
    knex: Knex,
    workflowName: string,
    options: WorkflowExecutionOptions
  ): Promise<WorkflowExecutionResult>;
  
  submitEvent(
    knex: Knex,
    options: EventSubmissionOptions
  ): Promise<WorkflowExecutionResult>;
  
  enqueueEvent(
    knex: Knex,
    options: EventSubmissionOptions
  ): Promise<EnqueueEventResult>;
  
  processQueuedEvent(
    knex: Knex,
    params: ProcessQueuedEventParams
  ): Promise<ProcessQueuedEventResult>;
  
  getExecutionState(executionId: string, tenant: string): Promise<WorkflowExecutionResult>;
  
  waitForWorkflowCompletion(
    executionId: string,
    tenant: string,
    options?: {
      maxWaitMs?: number;
      checkIntervalMs?: number;
      debug?: boolean;
    }
  ): Promise<boolean>;
}

export class TypeScriptWorkflowRuntime {
  private actionRegistry: ActionRegistry;
  private workflowDefinitions: Map<string, WorkflowDefinition> = new Map();
  private executionStates: Map<string, any> = new Map();
  private stateCache: Map<string, { timestamp: number, state: any }> = new Map();
  private readonly STATE_CACHE_TTL_MS = 60000; // 1 minute cache TTL
  
  constructor(actionRegistry: ActionRegistry) {
    this.actionRegistry = actionRegistry;
  }
  
  /**
   * Load a workflow execution state from events
   * This implements the event sourcing pattern by replaying events to derive state
   *
   * @param knex The Knex instance
   * @param executionId The workflow execution ID
   * @param tenant The tenant ID
   * @param options Options for event replay
   * @returns The derived execution state
   */
  async loadExecutionState(
    knex: Knex,
    executionId: string,
    tenant: string,
    options: EventReplayOptions = {}
  ): Promise<any> {
    // Check cache first if not explicitly bypassed
    if (!options.debug && !options.replayUntil) {
      const cachedState = this.stateCache.get(executionId);
      if (cachedState && (Date.now() - cachedState.timestamp) < this.STATE_CACHE_TTL_MS) {
        logger.debug(`[TypeScriptWorkflowRuntime] Using cached state for execution ${executionId}`);
        return cachedState.state;
      }
    }
    
    try {
      // Use event sourcing to replay events and derive state
      const result = await WorkflowEventSourcing.replayEvents(knex, executionId, tenant, options);
      
      // Store derived state in memory cache
      this.executionStates.set(executionId, result.executionState);
      
      // Update cache with timestamp
      if (!options.debug && !options.replayUntil) {
        this.stateCache.set(executionId, {
          timestamp: Date.now(),
          state: result.executionState
        });
      }
      
      return result.executionState;
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error loading execution state for ${executionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Register a workflow definition
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflowDefinitions.set(workflow.metadata.name, workflow);
  }
  
  /**
   * Get all registered workflow definitions
   * @returns Map of workflow definitions
   */
  getRegisteredWorkflows(): Map<string, WorkflowDefinition> {
    return new Map(this.workflowDefinitions);
  }
  
  /**
   * Get a workflow definition by name, loading from database if needed
   * This implements on-demand loading of workflow definitions
   *
   * @param workflowName The name of the workflow to get
   * @param version Optional version string
   * @returns The workflow definition or null if not found
   */
  async getWorkflowDefinition(workflowName: string, version?: string): Promise<WorkflowDefinition | null> {
    // First check if we have a code-registered workflow with this name
    const codeWorkflow = this.workflowDefinitions.get(workflowName);
    if (codeWorkflow) {
      return codeWorkflow;
    }
    
    try {
      // Not found in code registrations, try to load from database
      // We need to dynamically import the server actions to avoid circular dependencies
      // and to keep the shared code independent of server-specific code
      try {
        // Use dynamic import to load the server actions
        const { getWorkflowRegistration } = await import('server/src/lib/actions/workflow-runtime-actions');
        
        // Get the workflow registration from the database
        const registration = await getWorkflowRegistration(workflowName, version);
        
        if (!registration) {
          return null;
        }
        
        // Convert the stored definition to a WorkflowDefinition
        const serializedDefinition: SerializedWorkflowDefinition = {
          metadata: {
            name: registration.name,
            description: registration.definition.description || '',
            version: registration.version,
            tags: registration.definition.tags || []
          },
          executeFn: registration.definition.executeFn
        };
        
        // Deserialize the workflow definition
        return deserializeWorkflowDefinition(serializedDefinition);
      } catch (importError) {
        logger.error(`Failed to import workflow-runtime-actions:`, importError);
        return null;
      }
    } catch (error) {
      logger.error(`Failed to load workflow definition for ${workflowName}:`, error);
      return null;
    }
  }
  
  /**
   * Start a new workflow execution
   */
  async startWorkflow(
    knex: Knex,
    workflowName: string,
    options: WorkflowExecutionOptions
  ): Promise<WorkflowExecutionResult> {
    // Try to get the workflow definition (from code or database)
    const workflow = await this.getWorkflowDefinition(workflowName);
    if (!workflow) {
      throw new Error(`Workflow "${workflowName}" not found`);
    }
    
    // Generate a unique execution ID
    const executionId = `wf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      // Create initial execution state
      const executionState = {
        executionId,
        tenant: options.tenant,
        currentState: 'initial',
        data: options.initialData || {},
        events: [],
        isComplete: false
      };
      
      // Store execution state in memory
      this.executionStates.set(executionId, executionState);
      
      // Persist workflow execution record
      await WorkflowExecutionModel.create(knex, options.tenant, {
        workflow_name: workflowName,
        workflow_version: workflow.metadata.version || '1.0.0', // Default version if not specified
        current_state: 'initial',
        status: 'active',
        context_data: options.initialData || {},
        tenant: options.tenant
      });
      
      // Create initial workflow.started event
      const startEvent = {
        execution_id: executionId,
        event_name: 'workflow.started',
        event_type: 'system',
        tenant: options.tenant,
        from_state: 'none',
        to_state: 'initial',
        user_id: options.userId, // This is optional in IWorkflowEvent
        payload: {
          workflow_name: workflowName,
          workflow_version: workflow.metadata.version || '1.0.0', // Default version if not specified
          initial_data: options.initialData || {}
        }
      };
      
      // Persist the initial event
      await WorkflowEventModel.create(knex, options.tenant, startEvent);
      
      // Create workflow context
      const context = this.createWorkflowContext(executionId, options.tenant);
      
      // Start workflow execution in background
      this.executeWorkflow(workflow.execute, context, executionState);
      
      return {
        executionId,
        currentState: executionState.currentState,
        isComplete: executionState.isComplete
      };
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error starting workflow ${workflowName}:`, error);
      throw error;
    }
  }
  
  /**
   * Submit an event to a workflow execution
   * This is the synchronous version that processes the event immediately
   * but still persists the event for event sourcing
   */
  async submitEvent(knex: Knex, options: EventSubmissionOptions): Promise<WorkflowExecutionResult> {
    const { execution_id, event_name, payload, user_id, tenant } = options;
    
    try {
      // Load execution state using event sourcing
      const executionState = await this.loadExecutionState(knex, execution_id, tenant);
      
      // Store the previous state
      const previousState = executionState.currentState;
      
      // Create workflow event
      const workflowEvent: WorkflowEvent = {
        name: event_name,
        payload: payload || {},
        user_id,
        timestamp: new Date().toISOString()
      };
      
      // Add event to execution state
      executionState.events.push(workflowEvent);
      
      // Apply the event to update the state data
      executionState.data = WorkflowEventSourcing.applyEvent(executionState.data, workflowEvent);
      
      // Notify event listeners
      this.notifyEventListeners(execution_id, workflowEvent);
      
      // Persist the event to database for event sourcing
      const dbEvent = {
        execution_id,
        event_name,
        event_type: 'workflow',
        tenant,
        payload: payload || {},
        user_id,
        from_state: previousState,
        to_state: executionState.currentState,
      };
      
      // Persist the event
      await WorkflowEventModel.create(knex, tenant, dbEvent);
      
      // Update workflow execution record with new state
      await WorkflowExecutionModel.update(knex, tenant, execution_id, {
        current_state: executionState.currentState,
        context_data: executionState.data
      });
      
      return {
        executionId: execution_id,
        currentState: executionState.currentState,
        isComplete: executionState.isComplete
      };
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error submitting event to execution ${execution_id}:`, error);
      throw error;
    }
  }

  /**
   * Enqueues an event for asynchronous processing
   * Returns quickly after persisting the event and publishing to Redis
   *
   * @param knex The Knex instance
   * @param options Event submission options
   * @returns Promise resolving to the event ID
   */
  async enqueueEvent(knex: Knex, options: EventSubmissionOptions): Promise<EnqueueEventResult> {
    const { execution_id, event_name, payload, user_id, tenant, idempotency_key } = options;
    
    // Verify execution exists and is valid
    const executionState = this.executionStates.get(execution_id);
    if (!executionState) {
      throw new Error(`Workflow execution "${execution_id}" not found`);
    }
    
    // Verify tenant
    if (executionState.tenant !== tenant) {
      throw new Error(`Tenant mismatch for workflow execution "${execution_id}"`);
    }
    
    // Get Redis stream client
    const redisStreamClient = getRedisStreamClient();
    
    // Generate a unique event ID
    const eventId = idempotency_key || `evt-${Date.now()}-${uuidv4()}`;
    
    // Create event
    const event = {
      event_id: eventId,
      execution_id,
      event_name,
      event_type: 'workflow',
      tenant,
      payload: payload || {},
      user_id,
      from_state: executionState.currentState,
      to_state: executionState.currentState, // Initially the same as from_state, will be updated during processing
      created_at: new Date().toISOString()
    };
    
    // Generate a unique processing ID
    const processingId = `proc-${Date.now()}-${uuidv4()}`;
    
    try {
      // Use distributed transaction to persist event and publish to Redis
      await executeDistributedTransaction(knex, `workflow:${execution_id}`, async (trx: Knex.Transaction) => {
        // Persist event to database
        await trx('workflow_events').insert(event);
        
        // Create processing record
        await trx('workflow_event_processing').insert({
          processing_id: processingId,
          event_id: eventId,
          execution_id,
          tenant,
          status: 'pending',
          attempt_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
        // Publish to Redis stream
        const streamEvent = toStreamEvent(event);
        await redisStreamClient.publishEvent(streamEvent);
        
        // Update processing record status to published
        await WorkflowEventProcessingModel.markAsPublished(trx, tenant, processingId);
      });
      
      logger.info(`[TypeScriptWorkflowRuntime] Successfully enqueued event ${eventId} for execution ${execution_id}`, {
        eventId,
        executionId: execution_id,
        eventName: event_name
      });
      
      return {
        eventId,
        processingId
      };
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Failed to enqueue event for execution ${execution_id}:`, error);
      throw error;
    }
  }
  
  /**
   * Process a queued event from Redis stream
   * Called by worker processes to handle events asynchronously
   *
   * @param knex The Knex instance
   * @param params Parameters for processing the queued event
   * @returns Result of processing the event
   */
  async processQueuedEvent(
    knex: Knex,
    params: ProcessQueuedEventParams
  ): Promise<ProcessQueuedEventResult> {
    const { eventId, executionId, processingId, workerId, tenant } = params;
    
    // Acquire distributed lock to ensure only one worker processes this event
    const lockKey = `event:${eventId}:processing`;
    const lockOwner = `worker:${workerId}`;
    
    try {
      // Acquire lock with 5 second wait time and 60 second TTL
      const lockAcquired = await acquireDistributedLock(lockKey, lockOwner, {
        waitTimeMs: 5000,
        ttlMs: 60000
      });
      
      if (!lockAcquired) {
        return {
          success: false,
          errorMessage: 'Failed to acquire lock for event processing',
          actionsExecuted: []
        };
      }
      
      try {
        // Mark event as processing
        await WorkflowEventProcessingModel.markAsProcessing(knex, tenant, processingId, workerId);
        
        // Load the event from database
        const event = await WorkflowEventModel.getById(knex, tenant, eventId);
        if (!event) {
          throw new Error(`Event ${eventId} not found`);
        }
        
        // Load execution state using event sourcing
        // This ensures we have the latest state derived from all events
        const executionState = await this.loadExecutionState(knex, executionId, tenant);
        
        // Store the previous state
        const previousState = executionState.currentState;
        
        // Create a workflow event for the runtime
        const workflowEvent: WorkflowEvent = {
          name: event.event_name,
          payload: event.payload || {},
          user_id: event.user_id,
          timestamp: event.created_at
        };
        
        // Add event to execution state
        executionState.events.push(workflowEvent);
        
        // Apply the event to update the state data
        executionState.data = WorkflowEventSourcing.applyEvent(executionState.data, workflowEvent);
        
        // Notify event listeners
        this.notifyEventListeners(executionId, workflowEvent);
        
        // Update the event's to_state in the database
        await executeDistributedTransaction(knex, `workflow:${executionId}`, async (trx: Knex.Transaction) => {
          await trx('workflow_events')
            .where({
              event_id: eventId,
              tenant
            })
            .update({
              to_state: executionState.currentState
            });
          
          // Mark event processing as completed
          await WorkflowEventProcessingModel.markAsCompleted(trx, tenant, processingId);
        });
        
        // Return success result
        return {
          success: true,
          previousState,
          currentState: executionState.currentState,
          actionsExecuted: [] // In a real implementation, we would track action executions
        };
      } catch (error) {
        // Mark event as failed
        await WorkflowEventProcessingModel.markAsFailed(
          knex,
          tenant,
          processingId,
          error instanceof Error ? error.message : String(error)
        );
        
        logger.error(`[TypeScriptWorkflowRuntime] Error processing event ${eventId}:`, error);
        
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          actionsExecuted: []
        };
      } finally {
        // Release the lock
        await releaseDistributedLock(lockKey, lockOwner);
      }
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error in processQueuedEvent for event ${eventId}:`, error);
      
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        actionsExecuted: []
      };
    }
  }
  
  /**
   * Get the current state of a workflow execution
   * This method now uses the cached state if available, or loads it from events if needed
   */
  async getExecutionState(executionId: string, tenant: string): Promise<WorkflowExecutionResult> {
    try {
      // Check if we have the state in memory
      let executionState = this.executionStates.get(executionId);
      
      // If not in memory, load it using event sourcing
      if (!executionState) {
        // Create a new knex instance
        const knex = require('knex')({
          client: 'pg',
          connection: process.env.DATABASE_URL
        });
        executionState = await this.loadExecutionState(knex, executionId, tenant);
      }
      
      // Verify tenant
      if (executionState.tenant !== tenant) {
        throw new Error(`Tenant mismatch for workflow execution "${executionId}"`);
      }
      
      return {
        executionId,
        currentState: executionState.currentState,
        isComplete: executionState.isComplete
      };
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error getting execution state for ${executionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Wait for a workflow to complete
   * @param executionId The workflow execution ID
   * @param tenant The tenant ID
   * @param options Options for waiting
   * @returns Promise that resolves to true if the workflow completed, false if it timed out
   */
  async waitForWorkflowCompletion(
    executionId: string,
    tenant: string,
    options: {
      maxWaitMs?: number,
      checkIntervalMs?: number,
      debug?: boolean
    } = {}
  ): Promise<boolean> {
    const {
      maxWaitMs = 1000,
      checkIntervalMs = 50,
      debug = false
    } = options;
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Get the current state (now async)
        const state = await this.getExecutionState(executionId, tenant);
        
        if (debug) {
          console.log(`Checking workflow state: isComplete=${state.isComplete}, currentState=${state.currentState}`);
          
          if (state.isComplete) {
            // Get the execution state directly to check data
            const executionState = this.executionStates.get(executionId);
            if (executionState) {
              console.log('Execution state data:', executionState.data);
            }
          }
        }
        
        if (state.isComplete) {
          return true;
        }
      } catch (error) {
        if (debug) {
          console.error('Error checking workflow state:', error);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
    
    return false;
  }
  
  /**
   * Create a workflow context for execution
   */
  private createWorkflowContext(executionId: string, tenant: string): WorkflowContext {
    const executionState = this.executionStates.get(executionId)!;
    const eventListeners: Map<string, ((event: WorkflowEvent) => void)[]> = new Map();
    
    // Store event listeners in execution state
    executionState.eventListeners = eventListeners;
    
    // Create action proxy
    const actionProxy = this.createActionProxy(executionId, tenant);
    
    return {
      executionId,
      tenant,
      
      // Action proxy
      actions: actionProxy,
      
      // Data manager
      data: {
        get: <T>(key: string): T => {
          return executionState.data[key] as T;
        },
        set: <T>(key: string, value: T): void => {
          executionState.data[key] = value;
        }
      },
      
      // Event manager
      events: {
        waitFor: (eventName: string | string[]): Promise<WorkflowEvent> => {
          return new Promise((resolve) => {
            const eventNames = Array.isArray(eventName) ? eventName : [eventName];
            
            // Check if event already exists
            const existingEvent = executionState.events.find((e: WorkflowEvent) =>
              eventNames.includes(e.name) &&
              !e.processed
            );
            
            if (existingEvent) {
              existingEvent.processed = true;
              resolve(existingEvent);
              return;
            }
            
            // Register listener for future events
            const listener = (event: WorkflowEvent) => {
              if (eventNames.includes(event.name)) {
                event.processed = true;
                resolve(event);
              }
            };
            
            // Add listener for each event name
            eventNames.forEach(name => {
              if (!eventListeners.has(name)) {
                eventListeners.set(name, []);
              }
              eventListeners.get(name)!.push(listener);
            });
          });
        },
        emit: async (eventName: string, payload?: any): Promise<void> => {
          if (workflowConfig.distributedMode) {
            // Create a new knex instance
            const knex = require('knex')({
              client: 'pg',
              connection: process.env.DATABASE_URL
            });
            
            // Use distributed mode - enqueue event for asynchronous processing
            await this.enqueueEvent(knex, {
              execution_id: executionId,
              event_name: eventName,
              payload,
              tenant
            });
          } else {
            // Create a new knex instance
            const knex = require('knex')({
              client: 'pg',
              connection: process.env.DATABASE_URL
            });
            
            // Use synchronous mode - process event immediately
            await this.submitEvent(knex, {
              execution_id: executionId,
              event_name: eventName,
              payload,
              tenant
            });
          }
        }
      },
      
      // Logger
      logger: {
        info: (message: string, ...args: any[]): void => {
          console.log(`[INFO] [${executionId}] ${message}`, ...args);
        },
        warn: (message: string, ...args: any[]): void => {
          console.warn(`[WARN] [${executionId}] ${message}`, ...args);
        },
        error: (message: string, ...args: any[]): void => {
          console.error(`[ERROR] [${executionId}] ${message}`, ...args);
        },
        debug: (message: string, ...args: any[]): void => {
          console.debug(`[DEBUG] [${executionId}] ${message}`, ...args);
        }
      },
      
      // State management
      getCurrentState: (): string => {
        return executionState.currentState;
      },
      setState: (state: string): void => {
        executionState.currentState = state;
      }
    };
  }
  
  /**
   * Create a proxy for action execution
   */
  private createActionProxy(executionId: string, tenant: string): Record<string, any> {
    const proxy = {};
    
    // Get all registered actions
    const actions = this.actionRegistry.getRegisteredActions();
    
    // Create proxy methods for each action
    for (const [actionName, actionDef] of Object.entries(actions)) {
      // Convert camelCase to snake_case for the proxy method name
      const snakeCaseName = actionName.replace(/([A-Z])/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, '');
      
      // Create a function that executes the action
      const executeAction = async (params: any) => {
        return this.actionRegistry.executeAction(actionName, {
          tenant,
          executionId,
          parameters: params,
          idempotencyKey: `${executionId}-${actionName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
        });
      };
      
      // Create proxy method with snake_case name
      Object.defineProperty(proxy, snakeCaseName, {
        value: executeAction,
        enumerable: true
      });
      
      // Also create proxy method with original camelCase name
      Object.defineProperty(proxy, actionName, {
        value: executeAction,
        enumerable: true
      });
    }
    
    return proxy;
  }
  
  /**
   * Execute a workflow function
   */
  private async executeWorkflow(
    workflowFn: WorkflowFunction,
    context: WorkflowContext,
    executionState: any
  ): Promise<void> {
    try {
      // Execute the workflow function
      await workflowFn(context);
      
      // Mark workflow as complete
      executionState.isComplete = true;
    } catch (error) {
      // Handle workflow execution error
      console.error(`Error executing workflow ${executionState.executionId}:`, error);
      executionState.error = error;
    }
  }
  
  /**
   * Notify event listeners of a new event
   */
  private notifyEventListeners(executionId: string, event: WorkflowEvent): void {
    const executionState = this.executionStates.get(executionId);
    if (!executionState) return;
    
    // Get listeners for this event
    const listeners = executionState.eventListeners?.get(event.name) || [];
    
    // Notify listeners
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`Error notifying event listener:`, error);
      }
    }
  }
}

// Singleton instance
let runtimeInstance: TypeScriptWorkflowRuntime | null = null;

/**
 * Get the workflow runtime instance
 */
export function getWorkflowRuntime(actionRegistry?: ActionRegistry): TypeScriptWorkflowRuntime {
  if (!runtimeInstance) {
    if (!actionRegistry) {
      throw new Error('ActionRegistry must be provided when creating the workflow runtime');
    }
    runtimeInstance = new TypeScriptWorkflowRuntime(actionRegistry);
  }
  return runtimeInstance;
}

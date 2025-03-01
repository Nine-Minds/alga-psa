import { createTenantKnex } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowDefinition } from './workflowParser';
import { ActionToExecute, EventProcessingResult, StateMachine, WorkflowEvent, WorkflowContext } from './stateMachine';
import { createActionExecutor, EnhancedActionToExecute, ActionResult } from './actionExecutor';
import WorkflowExecutionModel from '../persistence/workflowExecutionModel';
import WorkflowEventModel from '../persistence/workflowEventModel';
import WorkflowTimerModel from '../persistence/workflowTimerModel';
import WorkflowActionResultModel from '../persistence/workflowActionResultModel';
import WorkflowEventProcessingModel from '../persistence/workflowEventProcessingModel';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { IWorkflowEvent, IWorkflowExecution, IWorkflowTimer } from '../persistence/workflowInterfaces';
import { IWorkflowEventProcessing } from '../persistence/workflowEventProcessingModel';
import { Knex } from 'knex';
import { getRedisStreamClient } from '../streams/redisStreamClient';
import {
  WorkflowEventBase,
  WorkflowEventProcessingStatus,
  toStreamEvent
} from '../streams/workflowEventSchema';
import logger from '../../../utils/logger';
import {
  acquireDistributedLock,
  releaseDistributedLock,
  executeDistributedTransaction,
  withRetry,
  classifyError,
  RecoveryStrategy
} from '../util';

/**
 * Parameters for enqueueing an event
 */
export interface EnqueueEventParams {
  executionId: string;           // ID of the workflow execution
  eventName: string;             // Name of the event to process
  payload?: Record<string, any>; // Event payload
  userRole?: string;             // Role of the user triggering the event
  tenant: string;                // Tenant identifier
  idempotencyKey?: string;       // Optional idempotency key for deduplication
}

/**
 * Parameters for processing an event
 */
export interface ProcessEventParams {
  executionId: string;           // ID of the workflow execution
  eventName: string;             // Name of the event to process
  payload?: Record<string, any>; // Event payload
  userRole?: string;             // Role of the user triggering the event
  tenant: string;                // Tenant identifier
}

/**
 * Result of enqueueing an event
 */
export interface EnqueueEventResult {
  success: boolean;              // Whether the event was enqueued successfully
  eventId: string;               // ID of the enqueued event
  processingId: string;          // ID of the processing record
  errorMessage?: string;         // Error message if not successful
}

/**
 * Parameters for processing a queued event
 */
export interface ProcessQueuedEventParams {
  eventId: string;               // ID of the event to process
  executionId: string;           // ID of the workflow execution
  processingId: string;          // ID of the processing record
  workerId: string;              // ID of the worker processing the event
  tenant: string;                // Tenant identifier
}

/**
 * Parameters for creating a workflow execution
 */
export interface CreateExecutionParams {
  executionId?: string;          // Optional ID for the execution (generated if not provided)
  workflowName: string;          // Name of the workflow
  workflowVersion?: string;      // Version of the workflow (defaults to 'latest')
  initialState?: string;         // Initial state (defaults to first state in definition)
  contextData?: Record<string, any>; // Initial context data
  tenant: string;                // Tenant identifier
}

/**
 * Result of processing an event
 */
export interface EventProcessingResponse {
  success: boolean;              // Whether the event was processed successfully
  executionId: string;           // ID of the workflow execution
  previousState: string;         // State before the event
  currentState: string;          // State after the event
  actionsExecuted: ActionResult[]; // Results of the actions executed
  errorMessage?: string;         // Error message if not successful
}

/**
 * Available event or action
 */
export interface AvailableAction {
  name: string;                  // Name of the event or action
  parameters?: Record<string, any>; // Required parameters
  description?: string;          // Description of the event or action
}

/**
 * Workflow details including state and available actions
 */
export interface WorkflowDetails {
  executionId: string;           // ID of the workflow execution
  workflowName: string;          // Name of the workflow
  currentState: string;          // Current state
  context: Record<string, any>;  // Current context data
  availableEvents: string[];     // Events that can be triggered
  availableActions: string[];    // Actions that can be executed
  history: IWorkflowEvent[];     // History of events
  activeTimers: IWorkflowTimer[]; // Active timers
}

/**
 * Workflow runtime engine that processes events, maintains state via event sourcing,
 * and executes actions in parallel based on dependencies.
 *
 * Supports both synchronous and asynchronous event processing:
 * - Synchronous: processEvent() - processes an event immediately and returns the result
 * - Asynchronous: enqueueEvent() - persists the event and publishes to Redis for later processing
 */
export class WorkflowRuntime {
  private stateMachine: StateMachine;
  private workflowRegistry: Map<string, WorkflowDefinition>;
  private redisStreamClient: ReturnType<typeof getRedisStreamClient>;
  
  /**
   * Create a new workflow runtime
   */
  constructor() {
    this.stateMachine = new StateMachine();
    this.workflowRegistry = new Map();
    this.redisStreamClient = getRedisStreamClient();
  }
  
  /**
   * Register a workflow definition
   * @param workflowName Name of the workflow
   * @param definition Workflow definition
   * @param version Version of the workflow (defaults to 'latest')
   */
  registerWorkflow(workflowName: string, definition: WorkflowDefinition, version: string = 'latest'): void {
    const key = `${workflowName}:${version}`;
    this.workflowRegistry.set(key, definition);
  }
  
  /**
   * Get a workflow definition
   * @param workflowName Name of the workflow
   * @param version Version of the workflow (defaults to 'latest')
   * @returns The workflow definition
   */
  getWorkflowDefinition(workflowName: string, version: string = 'latest'): WorkflowDefinition | undefined {
    const key = `${workflowName}:${version}`;
    return this.workflowRegistry.get(key);
  }
  
  /**
   * Create a new workflow execution
   * @param params Parameters for creating the execution
   * @returns The execution ID
   */
  async createExecution(params: CreateExecutionParams): Promise<string> {
    const executionId = params.executionId || uuidv4();
    
    // Get the workflow definition
    const workflowDef = this.getWorkflowDefinition(params.workflowName, params.workflowVersion);
    if (!workflowDef) {
      throw new Error(`Workflow definition not found: ${params.workflowName}:${params.workflowVersion || 'latest'}`);
    }
    
    // Determine initial state
    const initialState = params.initialState || workflowDef.states[0]?.name || 'initial';
    
    try {
      // Create execution record
      await WorkflowExecutionModel.create({
        tenant: params.tenant,
        workflow_name: params.workflowName,
        workflow_version: params.workflowVersion || 'latest',
        current_state: initialState,
        status: 'active',
        context_data: params.contextData || {}
      });
      
      return executionId;
    } catch (error) {
      console.error(`Error creating workflow execution:`, error);
      throw error;
    }
  }
  
  /**
   * Enqueue an event for asynchronous processing
   * This is a "fire and forget" operation that returns quickly after persisting the event
   * and publishing it to Redis Streams for later processing by a worker
   *
   * @param params Parameters for enqueueing the event
   * @returns Result of enqueueing the event
   */
  async enqueueEvent(params: EnqueueEventParams): Promise<EnqueueEventResult> {
    try {
      // Generate event ID and idempotency key if not provided
      const eventId = params.idempotencyKey || uuidv4();
      const idempotencyKey = params.idempotencyKey;
      
      // Check for idempotency - if this event was already enqueued, return the existing ID
      if (idempotencyKey) {
        // Since we don't have a getByIdempotencyKey method, we'll need to implement a different approach
        // For now, we'll just proceed with the new event ID
        logger.info(`[WorkflowRuntime] Using idempotency key ${idempotencyKey} as event ID`);
      }
      
      // Use withRetry for resilient execution
      return await withRetry(async () => {
        // Load workflow execution
        const execution = await WorkflowExecutionModel.getById(params.executionId);
        if (!execution) {
          return {
            success: false,
            eventId,
            processingId: '',
            errorMessage: `Workflow execution not found: ${params.executionId}`
          };
        }
        
        // Load workflow definition
        const workflowDef = this.getWorkflowDefinition(execution.workflow_name, execution.workflow_version);
        if (!workflowDef) {
          return {
            success: false,
            eventId,
            processingId: '',
            errorMessage: `Workflow definition not found: ${execution.workflow_name}:${execution.workflow_version}`
          };
        }
        
        // Validate that the event is allowed in the current state
        const dbEvents = await WorkflowEventModel.getByExecutionId(params.executionId);
        const eventLog: WorkflowEvent[] = dbEvents.map(dbEvent => ({
          event_id: dbEvent.event_id,
          execution_id: dbEvent.execution_id,
          event_name: dbEvent.event_name,
          tenant: dbEvent.tenant,
          payload: dbEvent.payload || {},
          user_id: dbEvent.user_id,
          timestamp: dbEvent.created_at,
          from_state: dbEvent.from_state,
          to_state: dbEvent.to_state
        }));
        
        // Get current state by replaying events
        const { currentState } = this.stateMachine.replayEvents(workflowDef, eventLog);
        
        // Check if the event is valid for the current state
        const availableEvents = this.stateMachine.getAvailableEvents(workflowDef, currentState);
        if (!availableEvents.includes(params.eventName)) {
          return {
            success: false,
            eventId,
            processingId: '',
            errorMessage: `Invalid event ${params.eventName} for current state ${currentState}`
          };
        }
        
        // Get the current user if available
        const currentUser = params.userRole ? await getCurrentUser() : undefined;
        const userId = currentUser ? uuidv4() : undefined; // Simplified for the implementation
        
        // Get Knex instance for database operations
        const { knex } = await createTenantKnex();
        let processingId = '';
        
        // Use distributed transaction for database operations
        await executeDistributedTransaction(
          knex,
          `workflow:${params.executionId}:enqueue`,
          async (trx) => {
            // Persist the event
            const eventData: Omit<IWorkflowEvent, 'event_id' | 'created_at'> = {
              tenant: params.tenant,
              execution_id: params.executionId,
              event_name: params.eventName,
              event_type: 'user_action', // Default type
              from_state: currentState,
              to_state: '', // Will be determined during processing
              user_id: userId,
              payload: params.payload
            };
            
            // Since we can't use the model with a transaction, use knex directly
            const [createdEvent] = await trx<IWorkflowEvent>('workflow_events')
              .insert({
                ...eventData,
                tenant: params.tenant
              })
              .returning('event_id');
            
            // Create processing record directly with knex
            const [processingRecord] = await trx<IWorkflowEventProcessing>('workflow_event_processing')
              .insert({
                event_id: createdEvent.event_id,
                execution_id: params.executionId,
                tenant: params.tenant,
                status: 'pending' as WorkflowEventProcessingStatus,
                attempt_count: 0
              })
              .returning('processing_id');
            
            processingId = processingRecord.processing_id;
            
            // Update execution status to indicate pending processing
            await trx('workflow_executions')
              .where({
                execution_id: params.executionId,
                tenant: params.tenant
              })
              .update({
                status: 'pending_processing',
                updated_at: new Date().toISOString()
              });
          },
          {
            isolationLevel: 'repeatable read'
          }
        );
        
        // Get the created event to publish to Redis
        const event = await WorkflowEventModel.getById(eventId);
        if (!event) {
          throw new Error(`Failed to retrieve created event: ${eventId}`);
        }
        
        // Convert to stream event format
        const streamEvent = toStreamEvent(event);
        
        // Publish to Redis Stream with retry
        await withRetry(async () => {
          await this.redisStreamClient.publishEvent(streamEvent);
        }, {
          maxRetries: 3,
          initialDelayMs: 500
        });
        
        // Update processing record to indicate published
        await WorkflowEventProcessingModel.markAsPublished(processingId);
        
        // Return success
        return {
          success: true,
          eventId,
          processingId
        };
      }, {
        maxRetries: 3,
        initialDelayMs: 1000
      });
    } catch (error: any) {
      // Classify the error
      const classification = classifyError(error);
      logger.error(`Error enqueueing event:`, {
        error,
        category: classification.category,
        strategy: classification.strategy,
        description: classification.description
      });
      
      return {
        success: false,
        eventId: '',
        processingId: '',
        errorMessage: classification.description
      };
    }
  }
  
  /**
   * Process an event for a workflow execution synchronously
   * @param params Parameters for processing the event
   * @returns Result of processing the event
   */
  async processEvent(params: ProcessEventParams): Promise<EventProcessingResponse> {
    try {
      // Load workflow execution
      const execution = await WorkflowExecutionModel.getById(params.executionId);
      if (!execution) {
        throw new Error(`Workflow execution not found: ${params.executionId}`);
      }
      
      // Load workflow definition
      const workflowDef = this.getWorkflowDefinition(execution.workflow_name, execution.workflow_version);
      if (!workflowDef) {
        throw new Error(`Workflow definition not found: ${execution.workflow_name}:${execution.workflow_version}`);
      }
      
      // Load all previous events for this execution
      const dbEvents = await WorkflowEventModel.getByExecutionId(params.executionId);
      
      // Convert database events to WorkflowEvent format
      const eventLog: WorkflowEvent[] = dbEvents.map(dbEvent => ({
        event_id: dbEvent.event_id,
        execution_id: dbEvent.execution_id,
        event_name: dbEvent.event_name,
        tenant: dbEvent.tenant,
        payload: dbEvent.payload || {},
        user_id: dbEvent.user_id,
        timestamp: dbEvent.created_at, // Use created_at as timestamp
        from_state: dbEvent.from_state,
        to_state: dbEvent.to_state
      }));
      
      // Get the current user if available
      const currentUser = params.userRole ? await getCurrentUser() : undefined;
      const userId = currentUser ? uuidv4() : undefined; // Simplified for the implementation
      
      // Create new event object
      const newEvent: WorkflowEvent = {
        event_id: uuidv4(),
        execution_id: params.executionId,
        event_name: params.eventName,
        tenant: params.tenant,
        payload: params.payload || {},
        user_id: userId,
        timestamp: new Date().toISOString(),
        from_state: execution.current_state,
        to_state: '' // Will be filled in after processing
      };
      
      // Process the event using the stateless state machine
      const context = execution.context_data || {};
      const result = this.stateMachine.processEvent(
        workflowDef,
        eventLog,
        newEvent,
        context
      );
      
      if (!result.isValid) {
        return {
          success: false,
          executionId: params.executionId,
          previousState: execution.current_state,
          currentState: execution.current_state,
          actionsExecuted: [],
          errorMessage: result.errorMessage || `Invalid event ${params.eventName} for current state ${execution.current_state}`
        };
      }
      
      // Update the event with the final destination state
      newEvent.to_state = result.nextState;
      
      // Begin transaction for database operations
      const { knex } = await createTenantKnex();
      let actionResults: ActionResult[] = [];
      
      await knex.transaction(async (trx) => {
        // Persist the event
        const eventData: Omit<IWorkflowEvent, 'event_id' | 'created_at'> = {
          tenant: params.tenant,
          execution_id: params.executionId,
          event_name: params.eventName,
          event_type: 'user_action', // Default type
          from_state: newEvent.from_state || '',
          to_state: newEvent.to_state || '',
          user_id: userId,
          payload: params.payload
        };
        
        await WorkflowEventModel.create(eventData);
        
        // Update execution current state (as a cache)
        await trx('workflow_executions')
          .where({
            execution_id: params.executionId,
            tenant: params.tenant
          })
          .update({
            current_state: result.nextState,
            context_data: context,
            updated_at: new Date().toISOString()
          });
      });
      
      // Execute actions using the dependency graph executor (outside the transaction)
      const enhancedActions = this.enhanceActions(result.actionsToExecute, newEvent);
      const actionExecutor = createActionExecutor();
      actionResults = await actionExecutor.executeActions(enhancedActions, newEvent, params.tenant);
      
      // Return the result
      return {
        success: true,
        executionId: params.executionId,
        previousState: result.previousState,
        currentState: result.nextState,
        actionsExecuted: actionResults
      };
    } catch (error: any) {
      logger.error(`Error processing event:`, error);
      return {
        success: false,
        executionId: params.executionId,
        previousState: '',
        currentState: '',
        actionsExecuted: [],
        errorMessage: error.message
      };
    }
  }
  
  /**
   * Process a queued event from Redis Streams
   * This is called by worker processes to handle events asynchronously
   *
   * @param params Parameters for processing the queued event
   * @returns Result of processing the event
   */
  async processQueuedEvent(params: ProcessQueuedEventParams): Promise<EventProcessingResponse> {
    // Generate a unique owner ID for distributed lock
    const lockOwnerId = `worker-${params.workerId}-${uuidv4().substring(0, 8)}`;
    
    // Create lock key based on event ID to ensure exclusive processing
    const lockKey = `event:${params.eventId}:processing`;
    
    try {
      // Update processing status to indicate processing has started
      await WorkflowEventProcessingModel.markAsProcessing(params.processingId, params.workerId);
      
      // Acquire distributed lock to ensure exclusive processing
      const lockAcquired = await acquireDistributedLock(lockKey, lockOwnerId, {
        waitTimeMs: 5000,  // Wait up to 5 seconds
        ttlMs: 60000,      // Lock expires after 60 seconds
        throwOnFailure: true
      });
      
      if (!lockAcquired) {
        throw new Error(`Failed to acquire lock for event ${params.eventId}`);
      }
      
      logger.debug(`[WorkflowRuntime] Acquired lock for event ${params.eventId}`);
      
      try {
        // Load the event
        const event = await WorkflowEventModel.getById(params.eventId);
        if (!event) {
          throw new Error(`Event not found: ${params.eventId}`);
        }
        
        // Load workflow execution
        const execution = await WorkflowExecutionModel.getById(params.executionId);
        if (!execution) {
          throw new Error(`Workflow execution not found: ${params.executionId}`);
        }
        
        // Load workflow definition
        const workflowDef = this.getWorkflowDefinition(execution.workflow_name, execution.workflow_version);
        if (!workflowDef) {
          throw new Error(`Workflow definition not found: ${execution.workflow_name}:${execution.workflow_version}`);
        }
        
        // Load all previous events for this execution
        const dbEvents = await WorkflowEventModel.getByExecutionId(params.executionId);
        
        // Convert database events to WorkflowEvent format
        const eventLog: WorkflowEvent[] = dbEvents.map(dbEvent => ({
          event_id: dbEvent.event_id,
          execution_id: dbEvent.execution_id,
          event_name: dbEvent.event_name,
          tenant: dbEvent.tenant,
          payload: dbEvent.payload || {},
          user_id: dbEvent.user_id,
          timestamp: dbEvent.created_at, // Use created_at as timestamp
          from_state: dbEvent.from_state,
          to_state: dbEvent.to_state
        }));
        
        // Create workflow event object from the database event
        const workflowEvent: WorkflowEvent = {
          event_id: event.event_id,
          execution_id: event.execution_id,
          event_name: event.event_name,
          tenant: event.tenant,
          payload: event.payload || {},
          user_id: event.user_id,
          timestamp: event.created_at,
          from_state: event.from_state,
          to_state: event.to_state || '' // Will be updated after processing
        };
        
        // Process the event using the stateless state machine
        const context = execution.context_data || {};
        const result = this.stateMachine.processEvent(
          workflowDef,
          eventLog,
          workflowEvent,
          context
        );
        
        if (!result.isValid) {
          // Mark processing as failed
          const errorMessage = result.errorMessage || `Invalid event ${event.event_name} for current state ${execution.current_state}`;
          await WorkflowEventProcessingModel.markAsFailed(params.processingId, errorMessage);
          
          return {
            success: false,
            executionId: params.executionId,
            previousState: execution.current_state,
            currentState: execution.current_state,
            actionsExecuted: [],
            errorMessage
          };
        }
        
        // Update the event with the final destination state
        workflowEvent.to_state = result.nextState;
        
        // Get Knex instance for database operations
        const { knex } = await createTenantKnex();
        let actionResults: ActionResult[] = [];
        
        // Use distributed transaction to ensure consistency
        await executeDistributedTransaction(
          knex,
          `workflow:${params.executionId}`,
          async (trx) => {
            // Update the event with the determined state transition
            await trx('workflow_events')
              .where({
                event_id: params.eventId,
                tenant: params.tenant
              })
              .update({
                to_state: result.nextState
              });
            
            // Update execution current state
            await trx('workflow_executions')
              .where({
                execution_id: params.executionId,
                tenant: params.tenant
              })
              .update({
                current_state: result.nextState,
                context_data: context,
                status: 'active',
                updated_at: new Date().toISOString()
              });
          },
          {
            isolationLevel: 'repeatable read'
          }
        );
        
        // Execute actions using the dependency graph executor with retry
        const enhancedActions = this.enhanceActions(result.actionsToExecute, workflowEvent);
        const actionExecutor = createActionExecutor();
        
        // Use withRetry for resilient action execution
        actionResults = await withRetry(
          async () => actionExecutor.executeActions(enhancedActions, workflowEvent, params.tenant),
          {
            maxRetries: 3,
            initialDelayMs: 1000
          }
        );
        
        // Mark processing as completed
        await WorkflowEventProcessingModel.markAsCompleted(params.processingId);
        
        // Return the result
        return {
          success: true,
          executionId: params.executionId,
          previousState: result.previousState,
          currentState: result.nextState,
          actionsExecuted: actionResults
        };
      } finally {
        // Always release the lock, even if processing fails
        try {
          await releaseDistributedLock(lockKey, lockOwnerId, false);
          logger.debug(`[WorkflowRuntime] Released lock for event ${params.eventId}`);
        } catch (error) {
          logger.warn(`[WorkflowRuntime] Failed to release lock for event ${params.eventId}:`, error);
        }
      }
    } catch (error: any) {
      // Classify the error to determine recovery strategy
      const classification = classifyError(error);
      logger.error(`Error processing queued event:`, {
        error,
        category: classification.category,
        strategy: classification.strategy,
        description: classification.description
      });
      
      // Mark processing as failed
      await WorkflowEventProcessingModel.markAsFailed(params.processingId, classification.description);
      
      return {
        success: false,
        executionId: params.executionId,
        previousState: '',
        currentState: '',
        actionsExecuted: [],
        errorMessage: classification.description
      };
    }
  }

  /**
   * Enhance actions with additional properties needed for execution
   * @param actions Basic actions from state machine
   * @param event Event that triggered the actions
   * @returns Enhanced actions
   */
  private enhanceActions(actions: ActionToExecute[], event: WorkflowEvent): EnhancedActionToExecute[] {
    return actions.map(action => {
      // Generate a unique ID for this action
      const id = uuidv4();
      
      // Generate an idempotency key based on the event and action
      const idempotencyKey = `${event.event_id}:${action.name}:${id}`;
      
      // Return enhanced action
      return {
        ...action,
        id,
        idempotencyKey
      };
    });
  }
  
  /**
   * Get workflow details including current state and available actions
   * @param tenant Tenant identifier
   * @param executionId Execution ID
   * @returns Workflow details
   */
  async getWorkflowDetails(tenant: string, executionId: string): Promise<WorkflowDetails> {
    // Load execution
    const execution = await WorkflowExecutionModel.getById(executionId);
    if (!execution) {
      throw new Error(`Workflow execution not found: ${executionId}`);
    }
    
    // Load workflow definition
    const workflowDef = this.getWorkflowDefinition(execution.workflow_name, execution.workflow_version);
    if (!workflowDef) {
      throw new Error(`Workflow definition not found: ${execution.workflow_name}:${execution.workflow_version}`);
    }
    
    // Load all events for this execution
    const dbEvents = await WorkflowEventModel.getByExecutionId(executionId);
    
    // Convert database events to WorkflowEvent format for replaying
    const events: WorkflowEvent[] = dbEvents.map(dbEvent => ({
      event_id: dbEvent.event_id,
      execution_id: dbEvent.execution_id,
      event_name: dbEvent.event_name,
      tenant: dbEvent.tenant,
      payload: dbEvent.payload || {},
      user_id: dbEvent.user_id,
      timestamp: dbEvent.created_at, // Use created_at as timestamp
      from_state: dbEvent.from_state,
      to_state: dbEvent.to_state
    }));
    
    // Get current state from the state machine by replaying events
    const { currentState, context } = this.stateMachine.replayEvents(workflowDef, events);
    
    // Get available events for the current state
    const availableEvents = this.stateMachine.getAvailableEvents(workflowDef, currentState);
    
    // Get available actions for the current state
    const availableActions = this.stateMachine.getAvailableActions(workflowDef, currentState);
    
    // Get active timers
    const activeTimers = await WorkflowTimerModel.getActiveByExecutionId(executionId);
    
    return {
      executionId,
      workflowName: execution.workflow_name,
      currentState,
      context,
      availableEvents,
      availableActions,
      history: dbEvents, // Use the original DB events as history
      activeTimers
    };
  }
}

/**
 * Create a new workflow runtime
 * @returns New workflow runtime instance
 */
export function createWorkflowRuntime(): WorkflowRuntime {
  return new WorkflowRuntime();
}
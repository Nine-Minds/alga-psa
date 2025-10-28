import { WorkflowContext, WorkflowFunction, WorkflowEvent, CreateTaskAndWaitForResultParams, CreateTaskAndWaitForResultReturn } from './workflowContext';
import { TaskEventNames } from '../persistence/taskInboxInterfaces';
import {
  WorkflowDefinition,
  deserializeWorkflowDefinition,
  SerializedWorkflowDefinition
} from './workflowDefinition';
import { ActionRegistry } from './actionRegistry';
import { WorkflowEventSourcing, EventReplayOptions } from './workflowEventSourcing';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getRedisStreamClient } from '@alga-psa/shared/workflow/streams/redisStreamClient';
import { executeDistributedTransaction } from '@alga-psa/shared/workflow/utils/distributedTransaction';
import { acquireDistributedLock, releaseDistributedLock } from '@alga-psa/shared/workflow/utils/distributedLock';
import { toStreamEvent } from '@alga-psa/shared/workflow/streams/workflowEventSchema';
import WorkflowEventModel from '@alga-psa/shared/workflow/persistence/workflowEventModel';
import WorkflowExecutionModel from '@alga-psa/shared/workflow/persistence/workflowExecutionModel';
import WorkflowEventProcessingModel from '@alga-psa/shared/workflow/persistence/workflowEventProcessingModel';
import WorkflowRegistrationModel from '@alga-psa/shared/workflow/persistence/workflowRegistrationModel';
import { logger } from '@alga-psa/shared/core';

// No configuration needed - all events are processed asynchronously

/**
 * Options for workflow execution by version ID
 */
export interface WorkflowVersionExecutionOptions {
  tenant: string;
  initialData?: Record<string, any>;
  userId?: string;
  versionId: string; // Required version_id from workflow_registration_versions
  isSystemManaged: boolean;
  correlationId?: string;
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
  
  getWorkflowDefinitionById( // Renamed and changed parameter
    knex: Knex,
    registrationId: string,
    isSystemManaged: boolean,
    tenantId?: string
  ): Promise<WorkflowDefinition | null>;
  startWorkflowByVersionId(
    knex: Knex,
    options: WorkflowVersionExecutionOptions
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
      // Use event sourcing to replay events and derive the data portion of the state
      const replayResult = await WorkflowEventSourcing.replayEvents(knex, executionId, tenant, options);
      const replayedDataState = replayResult.executionState; // Contains .data, .currentState, .events array, .isComplete

      // Fetch the full execution record to get workflowName and correlationId
      const executionRecord = await WorkflowExecutionModel.getById(knex, tenant, executionId);
      const workflowName = executionRecord?.workflow_name;
      const correlationId = executionRecord?.correlation_id;

      if (!executionRecord) {
        logger.warn(`[TypeScriptWorkflowRuntime] Execution record not found for ${executionId} during state load.`);
      }

      // Get the existing live state if this workflow is already active in this runtime instance
      let liveExecutionState = this.executionStates.get(executionId);

      if (liveExecutionState) {
        // Update the live state with replayed data, preserving listeners and other live properties
        liveExecutionState.data = replayedDataState.data;
        liveExecutionState.currentState = replayedDataState.currentState;
        liveExecutionState.events = replayedDataState.events; // The list of historical events
        liveExecutionState.isComplete = replayedDataState.isComplete;
        liveExecutionState.workflowName = workflowName || liveExecutionState.workflowName;
        liveExecutionState.correlationId = correlationId || liveExecutionState.correlationId;
        // IMPORTANT: liveExecutionState.eventListeners is preserved because we are modifying the existing object.
        logger.debug(`[TypeScriptWorkflowRuntime] Updated existing live state for execution ${executionId} with replayed data. Listeners preserved.`);
      } else {
        // No live state, create a new one from replayed data
        // This new state will NOT have eventListeners yet; they get added when createWorkflowContext is called
        // if this state is used to start/resume a workflow's JS execution (e.g. after a worker restart).
        liveExecutionState = {
          ...replayedDataState, // .data, .currentState, .events, .isComplete
          executionId,
          tenant,
          workflowName,
          correlationId,
          // eventListeners will be added by createWorkflowContext if this state is used to start a new workflow execution.
        };
        this.executionStates.set(executionId, liveExecutionState); // Store the new state object
        logger.debug(`[TypeScriptWorkflowRuntime] Created new state for execution ${executionId} from replayed data. No pre-existing listeners.`);
      }
      
      // Update the general state cache (which doesn't include live listeners)
      if (!options.debug && !options.replayUntil) {
        const stateForCache = { ...liveExecutionState };
        delete stateForCache.eventListeners; // Ensure listeners are not in the general cache

        this.stateCache.set(executionId, {
          timestamp: Date.now(),
          state: stateForCache 
        });
      }
      
      return liveExecutionState; // Return the (potentially updated) live state or new state
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
   * Get a workflow definition by registration ID, loading from the appropriate (tenant or system) database table.
   * Fetches the 'current' version.
   *
   * @param knex Knex instance
   * @param registrationId The registration ID of the workflow
   * @param isSystemManaged Flag indicating if it's a system workflow
   * @returns The workflow definition or null if not found
   */
  async getWorkflowDefinitionById(
    knex: Knex,
    registrationId: string,
    isSystemManaged: boolean,
    tenantId?: string
  ): Promise<WorkflowDefinition | null> {
    const registrationTable = isSystemManaged ? 'system_workflow_registrations' : 'workflow_registrations';
    const versionTable = isSystemManaged ? 'system_workflow_registration_versions' : 'workflow_registration_versions';

    if (!isSystemManaged && !tenantId) {
      logger.error(`[TypeScriptWorkflowRuntime] Tenant ID is required for non-system managed workflow definition lookup (registration ID: ${registrationId}).`);
      return null;
    }

    try {
      // Join registration and current version tables
      const queryBuilder = knex(`${registrationTable} as reg`)
        .join(`${versionTable} as ver`, function() {
          this.on('reg.registration_id', '=', 'ver.registration_id');
          this.andOn('ver.is_current', '=', knex.raw('?', [true]));
          if (!isSystemManaged && tenantId) {
            // For tenant workflows, registration and version must belong to the tenant.
            this.andOn('reg.tenant', '=', knex.raw('?', [tenantId]));
            // Assuming 'workflow_registration_versions' (tenant version table) has 'tenant'
            this.andOn('ver.tenant', '=', knex.raw('?', [tenantId]));
          }
        })
        .where('reg.registration_id', registrationId) // Primary filter by registrationId
        .select(
          'reg.name',
          'reg.description as reg_description',
          'reg.tags', // Select tags directly from the registration table
          'ver.version',
          'ver.code', // Select the new code column
          'ver.parameters'
        );

      const versionRecord = await queryBuilder.first();

      if (!versionRecord) {
        logger.warn(`No current version found for ${isSystemManaged ? 'system' : `tenant '${tenantId}'`} workflow registration ID: ${registrationId}`);
        return null;
      }

      // Convert the stored definition to a WorkflowDefinition
      const serializedDefinition: SerializedWorkflowDefinition = {
        metadata: {
          name: versionRecord.name || 'Unknown',
          description: versionRecord.reg_description || '', // Use reg_description directly
          version: versionRecord.version,
          tags: versionRecord.tags || [] // Use tags directly from versionRecord
        },
        // Use the code directly from the version table
        executeFn: versionRecord.code
      };

      if (!serializedDefinition.executeFn) {
         logger.error(`Workflow code not found in version record for workflow registration ID: ${registrationId}`);
         return null;
      }

      // Deserialize the workflow definition
      return deserializeWorkflowDefinition(serializedDefinition);
    } catch (error) {
      logger.error(`Failed to load ${isSystemManaged ? 'system' : `tenant (id: ${tenantId})`} workflow definition for registration ID ${registrationId}:`, error);
      return null;
    }
  }
  
  /**
   * Get the knex instance from the context
   * This is a placeholder method that should be implemented by the caller
   */
  private getKnexInstance(): Knex | null {
    // In a real implementation, this would get the knex instance from the context
    // For now, we'll return null to indicate that it's not available
    return null;
  }
  
  /**
   * Get the tenant from the context
   * This is a placeholder method that should be implemented by the caller
   */
  private getTenant(): string | null {
    // In a real implementation, this would get the tenant from the context
    // For now, we'll return a default tenant
    return 'default';
  }
  
  
  /**
   * Start a new workflow execution by version ID
   * This is the preferred method for starting workflows
   */
  async startWorkflowByVersionId(
    knex: Knex,
    options: WorkflowVersionExecutionOptions
  ): Promise<WorkflowExecutionResult> {
    const { versionId, tenant, isSystemManaged, userId, initialData, correlationId } = options;

    const baseRegistrationTable = isSystemManaged ? 'system_workflow_registrations' : 'workflow_registrations';
    const baseVersionTable = isSystemManaged ? 'system_workflow_registration_versions' : 'workflow_registration_versions';

    // Get the workflow registration version
    let versionQuery = knex(`${baseVersionTable} as wrv`)
      .join(`${baseRegistrationTable} as wr`, 'wrv.registration_id', 'wr.registration_id')
      .where({ 'wrv.version_id': versionId });

    if (!isSystemManaged) {
      // For tenant workflows, version and registration must belong to the tenant.
      versionQuery = versionQuery.andWhere({
        'wrv.tenant': tenant,
        'wr.tenant': tenant
      });
    }
    // For system workflows, no tenant filter is applied to these tables.

    const versionRecord = await versionQuery
      .select(
        'wr.name as workflow_name',
        'wrv.version',
        'wr.registration_id' // Fetch registration_id
      )
      .first();

    if (!versionRecord) {
      const scope = isSystemManaged ? 'system' : `tenant '${tenant}'`;
      throw new Error(`Workflow version "${versionId}" not found for ${scope}.`);
    }

    // Get the workflow definition using the fetched registration ID
    const registrationIdToUse = versionRecord.registration_id;
    const workflowDefinition = await this.getWorkflowDefinitionById(
        knex,
        registrationIdToUse,
        isSystemManaged,
        isSystemManaged ? undefined : tenant
    );

    if (!workflowDefinition) {
      const scope = isSystemManaged ? 'system' : `tenant '${tenant}'`;
      throw new Error(`Failed to load workflow definition for ${scope} registration ID "${registrationIdToUse}" (version ID "${versionId}")`);
    }
    
    // Generate a unique execution ID using UUID
    const executionId = uuidv4();
    
    try {
      // Create initial execution state
      const executionState = {
        executionId,
        workflowName: versionRecord.workflow_name,
        correlationId: correlationId, // Add correlationId here
        tenant: tenant,
        currentState: 'initial',
        data: initialData || {},
        events: [],
        isComplete: false
      };
      
      // Store execution state in memory
      this.executionStates.set(executionId, executionState);
      
      // Persist workflow execution record
      await WorkflowExecutionModel.create(knex, tenant, {
        execution_id: executionId,
        workflow_name: versionRecord.workflow_name,
        workflow_version: versionRecord.version,
        correlation_id: correlationId, // Add correlation_id here
        current_state: 'initial',
        status: 'active',
        context_data: initialData || {},
        tenant: tenant,
        version_id: versionId,
        workflow_type: options.isSystemManaged ? 'system' : 'tenant'
      });
      
      // Create initial workflow.started event
      const startEvent = {
        execution_id: executionId,
        event_name: 'workflow.started',
        event_type: 'system',
        tenant: tenant, // Use destructured tenant
        from_state: 'none',
        to_state: 'initial',
        user_id: userId, // Use destructured userId
        payload: {
          workflow_name: versionRecord.workflow_name,
          workflow_version: versionRecord.version,
          initial_data: initialData || {} // Use destructured initialData
        }
      };
      
      // Persist the initial event
      await WorkflowEventModel.create(knex, tenant, startEvent); // Use destructured tenant

      // Create workflow context with userId and knex connection
      // Passing knex ensures actions use the same connection, avoiding Citus cross-shard FK issues
      const context = await this.createWorkflowContext(executionId, tenant, userId, knex);

      // Start workflow execution in background
      this.executeWorkflow(workflowDefinition.execute, context, executionState);
      
      return {
        executionId,
        currentState: executionState.currentState,
        isComplete: executionState.isComplete
      };
    } catch (error) {
      logger.error(`[TypeScriptWorkflowRuntime] Error starting workflow by version ID ${options.versionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Submit an event to a workflow execution
   * This method processes the event and persists it for event sourcing
   * Note: This method is kept for backward compatibility but should be avoided in favor of enqueueEvent
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
   * This is the standard way to submit events to workflows
   * Returns quickly after persisting the event and publishing to Redis
   *
   * @param knex The Knex instance
   * @param options Event submission options
   * @returns Promise resolving to the event ID and processing ID
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
    
    // Generate a unique event ID. If an idempotency_key is provided, use it. Otherwise, generate a new UUID.
    const eventId = idempotency_key || uuidv4();
    
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
    const processingId = uuidv4(); // Removed "proc-" prefix and timestamp to ensure valid UUID
    
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
        
        // Load execution state. This will now return the live state if available,
        // updated with replayed data, and crucially, preserving existing eventListeners.
        const liveExecutionState = await this.loadExecutionState(knex, executionId, tenant);
        
        // Store the previous state (from the loaded/updated live state)
        const previousState = liveExecutionState.currentState;
        
        // Create a workflow event object for in-memory processing (e.g., for listeners)
        const workflowEvent: WorkflowEvent = {
          name: event.event_name, // 'event' is the raw event from DB
          payload: event.payload || {},
          user_id: event.user_id,
          timestamp: event.created_at
        };
        
        // The 'event' (from DB) is already part of the history replayed by loadExecutionState
        // if it was persisted before this processQueuedEvent call.
        // If this 'event' is the one causing the current processing, its data effects
        // should be applied to the liveExecutionState.data.
        // The liveExecutionState.events array (historical events) is already up-to-date from loadExecutionState.

        // Apply the current event's data changes to the liveExecutionState's data.
        // Note: WorkflowEventSourcing.applyEvent should be idempotent if the event was already replayed.
        // Or, ensure applyEvent is only for the *current* event's effect on data.
        // For now, let's assume applyEvent updates the data based on the workflowEvent.
        liveExecutionState.data = WorkflowEventSourcing.applyEvent(liveExecutionState.data, workflowEvent);
        
        // Notify event listeners. This will use the liveExecutionState (fetched via this.executionStates.get)
        // which should now correctly have its eventListeners property if the workflow was waiting.
        this.notifyEventListeners(executionId, workflowEvent);
        
        // After listeners are notified, the workflow might have resumed and changed its state.
        // So, we use liveExecutionState.currentState (which could have been updated by the resumed workflow)
        // as the to_state for the persisted event.
        await executeDistributedTransaction(knex, `workflow:${executionId}`, async (trx: Knex.Transaction) => {
          await trx('workflow_events')
            .where({
              event_id: eventId,
              tenant
            })
            .update({
              to_state: liveExecutionState.currentState
            });
          
          // Mark event processing as completed
          await WorkflowEventProcessingModel.markAsCompleted(trx, tenant, processingId);
        });
        
        // Return success result
        return {
          success: true,
          previousState,
          currentState: liveExecutionState.currentState,
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
        // Dynamically import knex
        const { default: knexFactory } = await import('knex');
        const knex = knexFactory({
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
  private async createWorkflowContext(executionId: string, tenant: string, userId?: string, knex?: any): Promise<WorkflowContext> {
    const knexForActions = await this.resolveKnexForActions(knex);
    const executionState = this.executionStates.get(executionId)!;
    const eventListeners: Map<string, ((event: WorkflowEvent) => void)[]> = new Map();

    // Store event listeners in execution state
    executionState.eventListeners = eventListeners;

    // Partially define context, then create actionProxy, then complete context.
    // This handles the circular dependency where actionProxy needs context, and context needs actionProxy.
    const context: WorkflowContext = {
      executionId,
      tenant,
      userId,
      actions: {} as any, // Placeholder, will be replaced by the fully constructed proxy
      data: {
        get: <T>(key: string): T => executionState.data[key] as T,
        set: <T>(key: string, value: T): void => { executionState.data[key] = value; }
      },
      events: {
        waitFor: (eventName: string | string[], timeoutMs?: number): Promise<WorkflowEvent['payload']> => {
          return new Promise((resolve, reject) => {
            const eventNames = Array.isArray(eventName) ? eventName : [eventName];
            let timeoutId: NodeJS.Timeout | undefined;

            if (timeoutMs) {
              timeoutId = setTimeout(() => {
                // Clean up listener
                eventNames.forEach(name => {
                  const listeners = eventListeners.get(name);
                  if (listeners) {
                    const index = listeners.indexOf(listener);
                    if (index > -1) {
                      listeners.splice(index, 1);
                    }
                    if (listeners.length === 0) {
                      eventListeners.delete(name);
                    }
                  }
                });
                reject(new Error(`Timeout waiting for event(s): ${eventNames.join(', ')} after ${timeoutMs}ms`));
              }, timeoutMs);
            }
            
            // Check if event already exists
            const existingEvent = executionState.events.find((e: WorkflowEvent) =>
              eventNames.includes(e.name) &&
              !e.processed // Ensure we only process events not yet processed by a waitFor
            );
            
            if (existingEvent) {
              if (timeoutId) clearTimeout(timeoutId);
              existingEvent.processed = true; // Mark as processed
              resolve(existingEvent.payload);
              return;
            }
            
            // Register listener for future events
            const listener = (event: WorkflowEvent) => {
              if (eventNames.includes(event.name)) {
                context.logger.debug(`[waitFor listener] Matched event: ${event.name}. Resolving promise for execution ${context.executionId}.`);
                if (timeoutId) clearTimeout(timeoutId);
                event.processed = true; // Mark as processed
                // Clean up listener after processing
                eventNames.forEach(name => {
                  const listeners = eventListeners.get(name);
                  if (listeners) {
                    const index = listeners.indexOf(listener);
                    if (index > -1) {
                      listeners.splice(index, 1);
                    }
                    if (listeners.length === 0) {
                      eventListeners.delete(name);
                    }
                  }
                });
                resolve(event.payload);
              } else {
                context.logger.debug(`[waitFor listener] Received event ${event.name}, but waiting for ${eventNames.join('/')}. No match for execution ${context.executionId}.`);
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
          // Dynamically import knex
          const { default: knexFactory } = await import('knex');
          const knex = knexFactory({
            client: 'pg',
            connection: process.env.DATABASE_URL
          });
          
          // Enqueue event for asynchronous processing
          await this.enqueueEvent(knex, {
            execution_id: executionId,
            event_name: eventName,
            payload,
            user_id: userId, // Pass the userId from the workflow context
            tenant
          });
        }
      },
      logger: {
        info: (message: string, ...args: any[]): void => {
          const { workflowName, correlationId } = executionState;
          const prefix = `[INFO] [${workflowName}${correlationId ? `:${correlationId}` : ''} (${executionId})]`;
          console.log(prefix, message, ...args);
        },
        warn: (message: string, ...args: any[]): void => {
          const { workflowName, correlationId } = executionState;
          const prefix = `[WARN] [${workflowName}${correlationId ? `:${correlationId}` : ''} (${executionId})]`;
          console.warn(prefix, message, ...args);
        },
        error: (message: string, ...args: any[]): void => {
          const { workflowName, correlationId } = executionState;
          const prefix = `[ERROR] [${workflowName}${correlationId ? `:${correlationId}` : ''} (${executionId})]`;
          console.error(prefix, message, ...args);
        },
        debug: (message: string, ...args: any[]): void => {
          const { workflowName, correlationId } = executionState;
          const prefix = `[DEBUG] [${workflowName}${correlationId ? `:${correlationId}` : ''} (${executionId})]`;
          console.debug(prefix, message, ...args);
        }
      },
      input: executionState.data, // Make the initial data available as input
      getCurrentState: (): string => executionState.currentState,
      setState: (state: string): void => { executionState.currentState = state; }
    };

    // Create action proxy, passing the context being built and the knex connection
    const actionProxyInstance = this.createActionProxy(executionId, tenant, context, knexForActions);
    context.actions = actionProxyInstance; // Now assign the fully built actions object

    return context;
  }

  private async resolveKnexForActions(knex?: any): Promise<any> {
    if (!knex) {
      return undefined;
    }

    const looksLikeTransaction = Boolean(knex?.isTransaction || knex?.client?.transacting);
    if (!looksLikeTransaction) {
      return knex;
    }

    const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
    return await getAdminConnection();
  }
  
  /**
   * Create a proxy for action execution
   */
  private createActionProxy(executionId: string, tenant: string, currentContext: WorkflowContext, knex?: any): WorkflowContext['actions'] {
    const tempProxy: { [key: string]: any } = {}; // Start with a generic object for easier construction

    // Get all registered actions
    const actions = this.actionRegistry.getRegisteredActions();

    // Create proxy methods for each action
    for (const [registeredName, actionDef] of Object.entries(actions)) {
      // Create a function that executes the action
      const executeAction = async (params: any) => {
        // Get the execution state to check if we have a user ID from a received event
        const currentExecutionState = this.executionStates.get(executionId);

        // Find the most recent event with a user_id, if any
        const userIdFromEvents = currentExecutionState?.events
          .slice()
          .reverse()
          .find((e: any) => e.user_id)?.user_id;

        // Include userId, workflowName, and correlationId in the action context if available
        // IMPORTANT: Always call actionRegistry.executeAction with the *original registeredName*

        // Log the secrets object from executionState.data before passing it to the action context
        console.log(`[DEBUG ActionProxy] Secrets from executionState.data for action ${registeredName} (executionId: ${executionId}):`, currentExecutionState?.data?.secrets);

        return this.actionRegistry.executeAction(registeredName, {
          tenant,
          executionId,
          workflowName: currentExecutionState?.workflowName,
          correlationId: currentExecutionState?.correlationId,
          secrets: currentExecutionState?.data?.secrets, // Pass secrets from execution state data
          parameters: params,
          idempotencyKey: `${executionId}-${registeredName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          userId: userIdFromEvents, // Include user ID from events if available
          knex: knex // Pass through the Knex connection to avoid cross-shard FK issues
        });
      };

      // 1. Define proxy for the exact registered name
      Object.defineProperty(tempProxy, registeredName, {
        value: executeAction,
        enumerable: true
      });

      // 2. If registeredName appears to be snake_case, create a camelCase alias
      if (registeredName.includes('_')) {
        const camelCaseName = registeredName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        // Only add if different and not already defined (though the latter is less likely here)
        if (camelCaseName !== registeredName && !tempProxy.hasOwnProperty(camelCaseName)) {
          Object.defineProperty(tempProxy, camelCaseName, {
            value: executeAction,
            enumerable: true // Typically aliases are also enumerable
          });
        }
      }
      // 3. Else if registeredName appears to be camelCase (no underscores, but has an uppercase char), create a snake_case alias
      else if (/[A-Z]/.test(registeredName)) {
        const snakeCaseName = registeredName.replace(/([A-Z])/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, '');
        // Only add if different and not already defined
        if (snakeCaseName !== registeredName && !tempProxy.hasOwnProperty(snakeCaseName)) {
          Object.defineProperty(tempProxy, snakeCaseName, {
            value: executeAction,
            enumerable: true // Typically aliases are also enumerable
          });
        }
      }
    }
    
    
    // Add the custom createTaskAndWaitForResult method
    tempProxy.createTaskAndWaitForResult = async (params: CreateTaskAndWaitForResultParams): Promise<CreateTaskAndWaitForResultReturn> => {
      const {
        taskType, title, description, priority, dueDate, assignTo, contextData,
        waitForEventTimeoutMilliseconds
      } = params;

      let createResult;
      try {
        // Use currentContext.actions to call the registered create_human_task action
        // IMPORTANT: currentContext.actions refers to the *same proxy object* we are building.
        // This means create_human_task must be available on it.
        if (!currentContext.actions.create_human_task) {
            currentContext.logger.error(`[context.actions.createTaskAndWaitForResult] 'create_human_task' action is not available on context.actions.`);
            return { success: false, error: "Internal configuration error: 'create_human_task' not found.", taskId: null };
        }
        createResult = await currentContext.actions.create_human_task({
          taskType, title, description, priority, dueDate, assignTo, contextData,
        });
      } catch (e: any) {
        currentContext.logger.error(`[context.actions.createTaskAndWaitForResult] Call to 'create_human_task' threw an error: ${e.message}`, e);
        return { success: false, error: `Failed to create human task (exception): ${e.message}`, taskId: null };
      }

      if (!createResult || !createResult.success || !createResult.taskId) {
        currentContext.logger.error(`[context.actions.createTaskAndWaitForResult] 'create_human_task' action failed. Params: ${JSON.stringify(params)}, Result: ${JSON.stringify(createResult)}`);
        return { success: false, error: 'Failed to create human task (action reported failure)', details: createResult, taskId: null };
      }
      const taskId: string = createResult.taskId;

      const eventName = TaskEventNames.taskCompleted(taskId);

      try {
        currentContext.logger.info(`[context.actions.createTaskAndWaitForResult] Workflow ${currentContext.executionId} now waiting for event: ${eventName} for task ${taskId}`);
        
        // Use currentContext.events.waitFor
        const eventPayload = await currentContext.events.waitFor(
          eventName,
          waitForEventTimeoutMilliseconds
        );

        currentContext.logger.info(`[context.actions.createTaskAndWaitForResult] Workflow ${currentContext.executionId} received event ${eventName} for task ${taskId}.`);
        
        return {
          success: true,
          resolutionData: eventPayload,
          taskId: taskId
        };

      } catch (error: any) {
        currentContext.logger.error(`[context.actions.createTaskAndWaitForResult] Workflow ${currentContext.executionId} error or timeout waiting for event ${eventName} for task ${taskId}: ${error.message}`, error);
        if (error.message.toLowerCase().includes('timeout')) {
          return { success: false, error: 'Timeout waiting for task resolution', taskId: taskId, resolutionData: null };
        }
        return { success: false, error: `Error waiting for task resolution: ${error.message}`, taskId: taskId, resolutionData: null };
      }
    };
    
    return tempProxy as WorkflowContext['actions']; // Cast at the end to the full type
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
      // Debug logging
      console.log('[executeWorkflow] context.input:', JSON.stringify(context.input));
      console.log('[executeWorkflow] executionState.data:', JSON.stringify(executionState.data));
      
      // Execute the workflow function
      await workflowFn(context);
      
      // Mark workflow as complete
      executionState.isComplete = true;
    } catch (error) {
      // Handle workflow execution error
      logger.error(`Error executing workflow ${executionState.executionId}:`, error);
      executionState.error = error;
    }
  }
  
  /**
   * Notify event listeners of a new event
   */
  private notifyEventListeners(executionId: string, event: WorkflowEvent): void {
    const executionState = this.executionStates.get(executionId);
    if (!executionState || !executionState.eventListeners) {
      logger.warn(`[notifyEventListeners] No execution state or eventListeners found for ${executionId} when trying to notify for event ${event.name}`);
      return; 
    }
    
    logger.debug(`[notifyEventListeners] Notifying for event: ${event.name} on execution ${executionId}. Available listeners on state: ${Array.from(executionState.eventListeners.keys()).join(', ')}`);

    // Get listeners for this event
    const listeners = executionState.eventListeners.get(event.name) || [];
    if (listeners.length === 0) {
      logger.debug(`[notifyEventListeners] No specific listeners registered for event ${event.name} on execution ${executionId}`);
    }
    
    // Notify listeners
    for (const listener of [...listeners]) { // Iterate over a copy in case listener modifies the array
      try {
        logger.debug(`[notifyEventListeners] Calling a listener for event ${event.name} on execution ${executionId}`);
        listener(event);
      } catch (error) {
        logger.error(`Error notifying event listener for ${event.name} on ${executionId}:`, error);
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

import { WorkflowEvent } from './workflowContext';
import { WorkflowEventModel } from '../persistence/index';
import { WorkflowSnapshotModel } from '../persistence/index';
import { IWorkflowEvent } from '../persistence/index';
import { Knex } from 'knex';

// Create a simple logger if @alga-psa/core is not available
const logger = {
  debug: (message: string, ...args: any[]) => console.debug(message, ...args),
  info: (message: string, ...args: any[]) => console.info(message, ...args),
  error: (message: string, ...args: any[]) => console.error(message, ...args)
};

/**
 * Interface for workflow state snapshot
 */
export interface WorkflowStateSnapshot {
  executionId: string;
  tenant: string;
  currentState: string;
  data: Record<string, any>;
  version: number;
  timestamp: string;
}

/**
 * Options for event replay
 */
export interface EventReplayOptions {
  /**
   * Whether to use snapshots for faster replay
   */
  useSnapshots?: boolean;
  
  /**
   * Maximum number of events to process in a single batch
   */
  batchSize?: number;
  
  /**
   * Specific point in time to replay events until
   */
  replayUntil?: string;
  
  /**
   * Whether to include debug information in the result
   */
  debug?: boolean;
}

/**
 * Result of event replay
 */
export interface EventReplayResult {
  /**
   * Derived execution state
   */
  executionState: {
    executionId: string;
    tenant: string;
    currentState: string;
    data: Record<string, any>;
    events: WorkflowEvent[];
    isComplete: boolean;
    workflowName?: string; // Added for consistency, populated by TypeScriptWorkflowRuntime.loadExecutionState
    correlationId?: string; // Added for consistency, populated by TypeScriptWorkflowRuntime.loadExecutionState
  };
  
  /**
   * Debug information (if requested)
   */
  debug?: {
    eventsProcessed: number;
    replayDurationMs: number;
    fromSnapshot: boolean;
    snapshotVersion?: number;
  };
}

/**
 * Utility class for event sourcing operations
 */
export class WorkflowEventSourcing {
  /**
   * Replay events for a workflow execution to derive its current state
   *
   * @param knex The Knex instance
   * @param executionId The workflow execution ID
   * @param tenant The tenant ID
   * @param options Options for event replay
   * @returns The derived execution state
   */
  static async replayEvents(
    knex: Knex,
    executionId: string,
    tenant: string,
    options: EventReplayOptions = {}
  ): Promise<EventReplayResult> {
    const startTime = Date.now();
    const {
      useSnapshots = true,
      batchSize = 100,
      replayUntil,
      debug = false
    } = options;
    
    let executionState = {
      executionId,
      tenant,
      currentState: 'initial',
      data: {},
      events: [] as WorkflowEvent[],
      isComplete: false
    };
    
    let fromSnapshot = false;
    let snapshotVersion: number | undefined;
    let eventsProcessed = 0;
    
    try {
      // Try to load from snapshot if enabled
      if (useSnapshots) {
        const snapshot = await WorkflowSnapshotModel.getLatestByExecutionId(knex, tenant, executionId);
        
        if (snapshot) {
          // Start from the snapshot state
          executionState = {
            executionId,
            tenant,
            currentState: snapshot.current_state,
            data: snapshot.data,
            events: [],
            isComplete: false // Will be determined by events
          };
          
          fromSnapshot = true;
          snapshotVersion = snapshot.version;
          
          logger.debug(`[WorkflowEventSourcing] Starting replay from snapshot version ${snapshotVersion} for execution ${executionId}`);
        }
      }
      
      // Load events from database
      let events: IWorkflowEvent[];
      
      if (fromSnapshot && snapshotVersion) {
        // If we're starting from a snapshot, only load events after the snapshot
        const snapshotTimestamp = new Date(snapshotVersion).toISOString();
        
        if (replayUntil) {
          // Load events between snapshot and specified time
          events = await WorkflowEventModel.getByExecutionIdBetween(
            knex,
            tenant,
            executionId,
            snapshotTimestamp,
            replayUntil
          );
        } else {
          // Load all events after the snapshot
          events = await WorkflowEventModel.getByExecutionIdAfter(
            knex,
            tenant,
            executionId,
            snapshotTimestamp
          );
        }
      } else if (replayUntil) {
        // Load events up to a specific point in time
        events = await WorkflowEventModel.getByExecutionIdUntil(knex, tenant, executionId, replayUntil);
      } else {
        // Load all events
        events = await WorkflowEventModel.getByExecutionId(knex, tenant, executionId);
      }
      
      if (events.length === 0 && !fromSnapshot) {
        throw new Error(`No events found for execution ${executionId}`);
      }
      
      // Process events to rebuild state
      for (const event of events) {
        // Convert database event to workflow event
        const workflowEvent: WorkflowEvent = {
          name: event.event_name,
          payload: event.payload || {},
          user_id: event.user_id,
          timestamp: event.created_at
        };
        
        // Add event to execution state
        executionState.events.push(workflowEvent);
        
        // Update state based on event
        executionState.currentState = event.to_state;
        
        // Apply event to update data
        executionState.data = this.applyEvent(executionState.data, workflowEvent);
        
        // Mark as processed to avoid reprocessing
        workflowEvent.processed = true;
        
        eventsProcessed++;
      }
      
      // Create a new snapshot if we processed a significant number of events
      // and we're not doing a time-bounded replay
      if (!replayUntil && eventsProcessed > 20 && !debug) {
        try {
          const newSnapshot: WorkflowStateSnapshot = {
            executionId,
            tenant,
            currentState: executionState.currentState,
            data: executionState.data,
            version: Date.now(),
            timestamp: new Date().toISOString()
          };
          
          // Create snapshot asynchronously (don't await)
          WorkflowSnapshotModel.create(knex, tenant, newSnapshot)
            .then(() => {
              // Prune old snapshots to avoid excessive storage
              return WorkflowSnapshotModel.pruneSnapshots(knex, tenant, executionId);
            })
            .catch(error => {
              logger.error(`[WorkflowEventSourcing] Error creating snapshot for execution ${executionId}:`, error);
            });
        } catch (error: any) {
          // Log but don't fail the replay if snapshot creation fails
          logger.error(`[WorkflowEventSourcing] Error creating snapshot for execution ${executionId}:`, error);
        }
      }
      
      // Check if workflow is complete based on the workflow state
      // This uses the actual workflow state to determine completion status
      const lastEvent = events[events.length - 1];
      
      // Get completion status from the workflow state
      // Different workflows may have different completion states
      const completionStates = ['completed', 'failed', 'cancelled', 'terminated'];
      if (completionStates.includes(lastEvent.to_state)) {
        executionState.isComplete = true;
      } else {
        // Check if there's a completion flag in the event payload
        const lastEventPayload = lastEvent.payload || {};
        if (lastEventPayload.isComplete === true || lastEventPayload.workflowComplete === true) {
          executionState.isComplete = true;
        }
      }
      
      logger.info(`[WorkflowEventSourcing] Successfully replayed ${eventsProcessed} events for execution ${executionId}`, {
        executionId,
        eventsProcessed,
        currentState: executionState.currentState,
        isComplete: executionState.isComplete,
        durationMs: Date.now() - startTime
      });
      
      return {
        executionState,
        debug: {
          eventsProcessed,
          replayDurationMs: Date.now() - startTime,
          fromSnapshot,
          snapshotVersion
        }
      };
    } catch (error: unknown) {
      logger.error(`[WorkflowEventSourcing] Error replaying events for execution ${executionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Apply an event to a workflow state
   * This is used during replay and when processing new events
   * 
   * @param state The current workflow state
   * @param event The event to apply
   * @returns The updated workflow state
   */
  static applyEvent(
    state: Record<string, any>,
    event: WorkflowEvent
  ): Record<string, any> {
    // Clone the state to avoid mutations
    const newState = { ...state };
    
    // Apply event-specific logic
    switch (event.name) {
      case 'workflow.started':
        // Initialize workflow data from payload
        return { ...newState, ...event.payload };
        
      case 'workflow.dataUpdated':
        // Update specific data fields
        if (event.payload && typeof event.payload === 'object') {
          return { ...newState, ...event.payload };
        }
        return newState;
        
      case 'workflow.completed':
        // Mark as completed with final data
        if (event.payload && typeof event.payload === 'object') {
          return { ...newState, ...event.payload };
        }
        return newState;
        
      default:
        // For custom events, merge payload if it's an object
        if (event.payload && typeof event.payload === 'object') {
          return { ...newState, ...event.payload };
        }
        return newState;
    }
  }
  
  /**
   * Create a snapshot of the current workflow state
   * This can be used to optimize future replays
   * 
   * @param executionId The workflow execution ID
   * @param tenant The tenant ID
   * @param state The current workflow state
   * @returns The created snapshot
   */
  static async createSnapshot(
    executionId: string,
    tenant: string,
    state: {
      currentState: string;
      data: Record<string, any>;
    }
  ): Promise<WorkflowStateSnapshot> {
    // Implementation for snapshot creation would go here
    // This would typically involve persisting the snapshot to a database
    
    const snapshot: WorkflowStateSnapshot = {
      executionId,
      tenant,
      currentState: state.currentState,
      data: state.data,
      version: Date.now(), // Use timestamp as version
      timestamp: new Date().toISOString()
    };
    
    // In a real implementation, you would persist this snapshot
    // For now, we'll just return it
    
    return snapshot;
  }
}

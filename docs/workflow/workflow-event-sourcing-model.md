# Workflow Event Sourcing Model

This document provides a comprehensive overview of the event sourcing architecture used in our workflow system. It explains how events are captured, stored, replayed, and used to derive workflow state, with specific focus on action execution, distributed processing, and recovery mechanisms.

## Table of Contents

1. [Introduction to Event Sourcing](#introduction-to-event-sourcing)
2. [Core Components](#core-components)
3. [Event Capture and Storage](#event-capture-and-storage)
4. [Event Replay and State Derivation](#event-replay-and-state-derivation)
5. [Action Execution Model](#action-execution-model)
6. [Distributed Execution Across Workers](#distributed-execution-across-workers)
7. [Recovery and Resilience](#recovery-and-resilience)
8. [Optimization Techniques](#optimization-techniques)

## Introduction to Event Sourcing

Event sourcing is an architectural pattern where all changes to an application's state are captured as a sequence of immutable events. Rather than storing the current state directly, the system derives the current state by replaying these events. This approach provides several benefits:

- Complete audit trail and history of all state changes
- Ability to reconstruct state at any point in time
- Natural fit for distributed and asynchronous processing
- Resilience to system failures and restarts

In our workflow system, event sourcing forms the foundation for workflow execution, enabling complex, long-running processes with seamless recovery capabilities.

## Core Components

Our workflow event sourcing implementation consists of these major components:

- **Event Models**: Definition of event types and structures
  - Key file: `/shared/workflow/persistence/workflowInterfaces.ts`

- **Event Storage**: Persistence mechanisms for events
  - Key file: `/shared/workflow/persistence/workflowEventModel.ts`

- **Event Sourcing Engine**: Core logic for event replay and state derivation
  - Key file: `/shared/workflow/core/workflowEventSourcing.ts`

- **Workflow Runtime**: Execution engine that processes workflows
  - Key file: `/shared/workflow/core/workflowRuntime.ts`

- **Action Registry**: Registration and execution of workflow actions
  - Key file: `/shared/workflow/core/actionRegistry.ts`

- **Worker Service**: Distributed processing of workflow events
  - Key file: `/services/workflow-worker/src/WorkflowWorker.ts`

## Event Capture and Storage

### Event Structure

Events in our system follow a consistent structure defined in `workflowInterfaces.ts`:

```typescript
export interface IWorkflowEvent {
  event_id: string;
  tenant: string;
  execution_id: string;
  event_name: string;
  event_type: string;
  from_state: string;
  to_state: string;
  user_id?: string;
  payload?: Record<string, any>;
  created_at: string;
}
```

Each event represents a significant occurrence in a workflow's lifecycle, such as:
- Workflow state transitions
- Action execution results
- External system interactions
- User-triggered events

### Storage Mechanism

Events are stored in the `workflow_events` table and managed through the `WorkflowEventModel` component, which provides methods to create, retrieve, and query events.

Key functions in `workflowEventModel.ts`:
- `create`: Persists a new event to the database
- `getByExecutionId`: Retrieves all events for a specific workflow execution
- `getByExecutionIdUntil`: Retrieves events up to a specific point in time

The system also publishes events to Redis streams for distributed processing:

```typescript
// From workflowRuntime.ts - enqueueEvent method
await redisStreamClient.publishEvent(streamEvent);
```

## Event Replay and State Derivation

The heart of our event sourcing implementation is the ability to replay events to derive workflow state.

### Replay Process

The replay process is implemented in `workflowEventSourcing.ts` through the `replayEvents` method:

```typescript
static async replayEvents(
  knex: Knex,
  executionId: string,
  tenant: string,
  options: EventReplayOptions = {}
): Promise<EventReplayResult>
```

This method:
1. Retrieves all events for a workflow execution
2. Optionally starts from a snapshot for performance
3. Applies each event sequentially to build the current state
4. Returns the derived execution state

The `applyEvent` method handles the specific logic for updating state based on event type:

```typescript
static applyEvent(
  state: Record<string, any>,
  event: WorkflowEvent
): Record<string, any>
```

### State Structure

The workflow execution state consists of:
- `executionId`: Unique identifier for the workflow execution
- `tenant`: Tenant identifier for multi-tenancy
- `currentState`: Current state name of the workflow
- `data`: Data object containing workflow variables and action results
- `events`: Array of processed events
- `isComplete`: Flag indicating if the workflow has completed

## Action Execution Model

### Action Registry

Actions are registered through the `ActionRegistry` component, which maintains a catalog of available actions and handles their execution:

```typescript
// From actionRegistry.ts
export class ActionRegistry {
  private actions: Map<string, ActionDefinition> = new Map();
  
  async executeAction(
    actionName: string,
    context: ActionExecutionContext
  ): Promise<any> {
    // ...
  }
}
```

### Action Proxy

When a workflow executes, it receives an action proxy that provides access to registered actions:

```typescript
// From workflowRuntime.ts
private createActionProxy(executionId: string, tenant: string): Record<string, any> {
  const proxy = {};
  
  // Get all registered actions
  const actions = this.actionRegistry.getRegisteredActions();
  
  // Create proxy methods for each action
  for (const [actionName, actionDef] of Object.entries(actions)) {
    // ...
    
    // Create a function that executes the action
    const executeAction = async (params: any) => {
      return this.actionRegistry.executeAction(actionName, {
        tenant,
        executionId,
        parameters: params,
        idempotencyKey: `${executionId}-${actionName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
    };
    
    // ...
  }
  
  return proxy;
}
```

### Idempotent Action Execution

To prevent duplicate action execution during replays, the system uses idempotency keys:

1. Each action execution gets a unique idempotency key
2. The system checks if an action with this key has already been executed
3. If found, it returns the stored result rather than re-executing the action

This is implemented in `workflowActionResultModel.ts` with the `getByIdempotencyKey` method:

```typescript
getByIdempotencyKey: async (knex: Knex, tenant: string, idempotencyKey: string): Promise<IWorkflowActionResult | null>
```

## Distributed Execution Across Workers

Our workflow system supports distributed execution across multiple worker instances, enabling parallel processing of independent actions.

### Event Distribution

Events are distributed through Redis streams, allowing multiple workers to consume and process events:

```typescript
// From WorkflowWorker.ts
this.redisStreamClient.registerConsumer(
  streamName,
  this.processGlobalEvent.bind(this)
);
```

### Parallel Action Execution

When a workflow contains parallel actions (such as using Promise.all), these actions can be processed by different worker instances:

```typescript
// Example workflow code
const a = functionA();
const b = functionB();
await Promise.all([a, b]);
```

In this code:
1. `functionA` and `functionB` are dispatched as independent actions
2. Different worker instances can pick up and process each action
3. Results are communicated back through events
4. The workflow continues when both actions complete

### Communication Mechanism

Results from distributed action execution are communicated back through events:
1. Worker completes an action and stores the result
2. Worker publishes a completion event
3. The workflow runtime receives the event
4. Event listeners for the original promise are notified
5. The promise resolves with the action result

This pattern is implemented in the `notifyEventListeners` method:

```typescript
// From workflowRuntime.ts
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
```

## Recovery and Resilience

One of the key benefits of our event sourcing architecture is its resilience to system failures and restarts.

### Workflow State Recovery

If the workflow runtime is restarted, workflow execution can resume seamlessly:
1. Events are replayed to reconstruct the workflow state
2. The execution continues from where it left off
3. Promises waiting on action results are re-established
4. When action completion events arrive, execution proceeds

This recovery process is handled through the event replay mechanism described earlier.

### In-flight Action Handling

Actions that were in-flight when a failure occurred are handled through:
1. Idempotency checks to prevent duplicate execution
2. Distributed locks to ensure exclusive processing
3. Event-based communication for result propagation

Example of distributed locking:

```typescript
// From workflowRuntime.ts - processQueuedEvent method
const lockKey = `event:${eventId}:processing`;
const lockOwner = `worker:${workerId}`;

const lockAcquired = await acquireDistributedLock(lockKey, lockOwner, {
  waitTimeMs: 5000,
  ttlMs: 60000
});
```

## Optimization Techniques

### Snapshots

To improve replay performance, the system can create and use snapshots of workflow state:

```typescript
// From workflowEventSourcing.ts
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
```

### State Caching

The system uses in-memory caching to reduce database load:

```typescript
// From workflowRuntime.ts
if (!options.debug && !options.replayUntil) {
  const cachedState = this.stateCache.get(executionId);
  if (cachedState && (Date.now() - cachedState.timestamp) < this.STATE_CACHE_TTL_MS) {
    logger.debug(`[TypeScriptWorkflowRuntime] Using cached state for execution ${executionId}`);
    return cachedState.state;
  }
}
```

### Batch Processing

Events can be processed in batches to improve performance:

```typescript
// From workflowEventSourcing.ts
const {
  useSnapshots = true,
  batchSize = 100,
  replayUntil,
  debug = false
} = options;
```

## Conclusion

The event sourcing architecture of our workflow system provides a robust foundation for building complex, long-running workflows with excellent resilience and scalability. By capturing all changes as events, we gain a complete audit trail and the ability to reconstruct workflow state at any point in time.

This document has covered the key aspects of our implementation, from event capture and storage to replay, action execution, and distributed processing. Understanding these concepts is essential for working with and extending the workflow system effectively.
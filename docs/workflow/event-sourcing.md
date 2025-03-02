# Workflow Event Sourcing

This document describes the event sourcing pattern implementation in the workflow system.

## Overview

Event sourcing is a pattern where the state of a system is determined by a sequence of events rather than just the current state. In our workflow system, this means that instead of storing just the current state of a workflow, we store all events that have occurred during the workflow's lifecycle. The current state is then derived by replaying these events.

## Benefits

1. **Complete Audit Trail**: Every change to the workflow state is recorded as an event, providing a complete history of what happened.
2. **Temporal Queries**: The ability to determine the state of a workflow at any point in time by replaying events up to that point.
3. **Reliable Replay**: Workflows can be replayed from the beginning to reconstruct their state, making the system more resilient.
4. **Decoupled Processing**: Events can be processed asynchronously, allowing for better scalability.
5. **Idempotent Operations**: Events can be processed multiple times without changing the outcome, making the system more robust.

## Implementation

### Core Components

1. **WorkflowEventModel**: Persists and retrieves workflow events from the database.
2. **WorkflowSnapshotModel**: Stores point-in-time snapshots of workflow state to optimize replay performance.
3. **WorkflowEventSourcing**: Provides utilities for replaying events and deriving state.
4. **TypeScriptWorkflowRuntime**: Uses event sourcing to manage workflow state.

### Event Structure

Events in our system have the following structure:

```typescript
interface IWorkflowEvent {
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

### State Derivation

The current state of a workflow is derived by replaying all events in chronological order. This process involves:

1. Loading all events for a workflow execution from the database.
2. Starting with an initial state (or a snapshot if available).
3. Applying each event to the state in sequence.
4. The final state after applying all events represents the current state of the workflow.

### Performance Optimization with Snapshots

To improve performance, especially for long-running workflows with many events, we use snapshots:

1. A snapshot is a point-in-time capture of the workflow state after applying a certain number of events.
2. When replaying events, if a snapshot is available, we can start from the snapshot state and only replay events that occurred after the snapshot.
3. Snapshots are created automatically when a significant number of events have been processed.
4. Old snapshots are pruned to avoid excessive storage usage.

### Distributed Processing

The event sourcing pattern enables distributed processing of workflows:

1. Events are submitted and persisted in one phase (via `enqueueEvent`).
2. Events are processed asynchronously in a separate phase (via `processQueuedEvent`).
3. Worker processes can replay events to derive the current state before processing new events.
4. This decoupling allows for horizontal scaling of the workflow system.

## Usage

### Submitting Events

Events can be submitted to a workflow in two ways:

1. **Synchronous**: Using `submitEvent` which processes the event immediately.
2. **Asynchronous**: Using `enqueueEvent` which persists the event and publishes it to Redis Streams for asynchronous processing.

### Replaying Events

Events can be replayed to derive the state of a workflow:

```typescript
const result = await WorkflowEventSourcing.replayEvents(executionId, tenant, {
  useSnapshots: true, // Use snapshots for performance optimization
  replayUntil: '2025-03-01T12:00:00Z', // Optional: replay events only up to this point
  debug: true // Include debug information in the result
});

const state = result.executionState;
```

### Creating Snapshots

Snapshots are created automatically during event replay when a significant number of events have been processed. They can also be created manually:

```typescript
const snapshot = await WorkflowEventSourcing.createSnapshot(
  executionId,
  tenant,
  {
    currentState: 'processing',
    data: { /* workflow data */ }
  }
);
```

## Testing

The event sourcing implementation includes comprehensive tests to ensure reliability:

1. **Unit Tests**: Test individual components like `WorkflowEventSourcing`.
2. **Integration Tests**: Test the interaction between components.
3. **Replay Tests**: Verify that events can be correctly replayed to derive state.
4. **Snapshot Tests**: Ensure that snapshots are correctly created and used.

Run the tests with:

```bash
cd server && npx vitest run src/test/unit/workflowEventSourcing.test.ts
```

## Conclusion

Event sourcing provides a robust foundation for our workflow system, enabling reliable state management, complete audit trails, and distributed processing. By storing the complete history of events and deriving state from them, we ensure that workflows can be reliably replayed and their state can be reconstructed at any point in time.
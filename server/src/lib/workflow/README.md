# Distributed Workflow Engine with Idempotent Action Registry

This directory contains a robust workflow engine implementation with event sourcing, parallel execution, asynchronous processing via Redis Streams, and an idempotent action registry system.

## Distributed Architecture Overview

The workflow engine is built on an event-sourced, distributed architecture that enables asynchronous processing across multiple servers while maintaining strong consistency and fault tolerance.

```
┌────────────────┐     ┌─────────────┐     ┌─────────────────┐     ┌───────────────┐
│  Client Request│────►│ Event       │────►│ Redis Streams   │────►│ Worker        │
│                │     │ Persistence │     │                 │     │ Processes     │
└────────────────┘     └─────────────┘     └─────────────────┘     └───────┬───────┘
                                                                           │
                                                                           │
                                                                           ▼
                                                                  ┌───────────────┐
                                                                  │ Action        │
                                                                  │ Execution     │
                                                                  └───────────────┘
```

### Key Architectural Principles

1. **Event Sourcing**: All state changes are represented as a sequence of events
2. **Two-Phase Event Processing**:
   - Phase 1: Synchronous event persistence (fire-and-forget)
   - Phase 2: Asynchronous event processing and action execution
3. **Distributed Processing**: Workers can run on different servers and process events from shared queues
4. **Idempotent Execution**: All operations are idempotent, enabling retry safety and fault tolerance
5. **Exactly-Once Processing**: Combination of idempotent operations and persistent state tracking
6. **Redis Streams Integration**: Leverages Redis Streams for reliable, ordered message delivery

### Technical Benefits

- **Asynchronous Processing**: Client requests complete quickly after event persistence
- **Horizontal Scalability**: Multiple worker processes can handle event processing in parallel
- **Fault Tolerance**: If a worker fails, another can pick up and process the same event
- **High Availability**: System remains operational even if some workers are temporarily unavailable
- **Natural Replay Capability**: The event-sourced design enables easy replay and auditing

## Core Components

### Action Registry

The Action Registry (`actionRegistry.ts`) provides a centralized system for registering and executing actions within workflows. Key features include:

- **Idempotent Execution**: Each action is executed exactly once using idempotency keys
- **Transaction Support**: Database actions can be executed within transactions with configurable isolation levels
- **Parameter Validation**: Automatic validation of action parameters against schemas
- **Error Handling**: Robust error handling with detailed error reporting
- **Built-in Actions**: Common actions like database operations and notifications are pre-registered

### Action Executor

The Action Executor (`actionExecutor.ts`) handles parallel execution of actions based on dependencies:

- **Dependency Graph**: Actions are organized in a dependency graph for efficient execution
- **Parallel Execution**: Independent actions are executed concurrently
- **Synchronization Points**: Fork/join patterns for complex parallel workflows
- **Error Strategies**: Configurable error handling (stop, continue, retry, compensate)
- **Retry Mechanism**: Automatic retry of failed actions with configurable retry limits

### State Machine

The State Machine (`stateMachine.ts`) implements the core workflow logic:

- **Event Sourcing**: State is derived from the event log
- **Stateless Design**: Each operation is a pure function of (previous events + new event)
- **Condition Evaluation**: Evaluates conditions against context data
- **Action Determination**: Determines actions to execute based on transitions

### Workflow Runtime

The Workflow Runtime (`workflowRuntime.ts`) ties everything together:

- **Event Persistence**: Persists events to the database and publishes to Redis Streams
- **Event Processing**: Processes events by replaying the event log to determine actions
- **Action Execution**: Executes actions using the Action Executor
- **Timer Management**: Handles timer-based events and scheduled transitions
- **Tenant Isolation**: Ensures proper tenant isolation for multi-tenant environments

### Redis Stream Integration

The Redis Stream integration (`redisStreamClient.ts`) handles asynchronous messaging:

- **Event Publishing**: Publishes workflow events to Redis Streams
- **Message Subscription**: Subscribes to streams for processing
- **Type Safety**: Ensures message type safety through Zod schemas
- **Error Handling**: Robust error handling and retry mechanisms

### Worker Service

The Worker Service (`workflowWorker.ts`) handles distributed event processing:

- **Event Consumption**: Consumes events from Redis Streams
- **Distributed Processing**: Can run on multiple servers for scalability
- **Error Handling**: Handles processing errors with appropriate logging and recovery
- **Health Monitoring**: Reports worker health status

## Usage

### Registering Actions

```typescript
import { getActionRegistry, TransactionIsolationLevel } from '../workflow/core/actionRegistry';

// Get the action registry
const registry = getActionRegistry();

// Register a simple action
registry.registerSimpleAction(
  'SendNotification',
  'Send a notification to a user',
  [
    { name: 'userId', type: 'string', required: true },
    { name: 'message', type: 'string', required: true }
  ],
  async (params) => {
    // Implementation
    console.log(`Sending notification to ${params.userId}: ${params.message}`);
    return { sent: true };
  }
);

// Register a database action
registry.registerDatabaseAction(
  'UpdateInvoiceStatus',
  'Update the status of an invoice',
  [
    { name: 'invoiceId', type: 'string', required: true },
    { name: 'status', type: 'string', required: true }
  ],
  TransactionIsolationLevel.REPEATABLE_READ,
  async (params, context) => {
    // Implementation using the transaction
    await context.transaction('invoices')
      .where({ id: params.invoiceId })
      .update({ status: params.status });
    return { updated: true };
  }
);
```

### Starting a Workflow

```typescript
import { createWorkflowRuntime } from '../workflow/core/workflowRuntime';

// Create a workflow runtime
const workflowRuntime = createWorkflowRuntime();

// Start a new workflow
const executionId = await workflowRuntime.createExecution({
  workflowName: 'InvoiceApproval',
  workflowVersion: 'latest',
  tenant: 'tenant-id'
});

// Process an initial event asynchronously
// This returns quickly after persisting the event and enqueueing it
const { eventId } = await workflowRuntime.enqueueEvent({
  executionId,
  eventName: 'CreateInvoice',
  tenant: 'tenant-id',
  userRole: 'admin',
  payload: {
    invoice: {
      id: 'invoice-123',
      total: 1000,
      customerId: 'customer-456'
    }
  }
});
```

### Processing Events

```typescript
// Enqueue a subsequent event for asynchronous processing
const { eventId } = await workflowRuntime.enqueueEvent({
  executionId,
  eventName: 'ApproveInvoice',
  tenant: 'tenant-id',
  userRole: 'manager',
  payload: {
    approvedBy: 'user-789',
    approvalDate: '2025-03-01'
  }
});
```

### Starting Workers

```typescript
import { startWorkflowWorker } from '../workflow/workers/workflowWorker';

// Start a worker to process events from Redis Streams
// This would typically be done in a separate process or service
startWorkflowWorker();
```

## Idempotency

The action registry ensures that each action is executed exactly once, even if the same event is processed multiple times. This is achieved through idempotency keys that uniquely identify each action execution.

When an action is executed:

1. The system checks if an action with the same idempotency key has already been executed
2. If found, the stored result is returned without re-executing the action
3. If not found, the action is executed and the result is stored for future reference

This makes the system resilient to retries, duplicates, and server restarts, which is essential for distributed processing.

## Transaction Isolation Levels

Database actions can be executed with different transaction isolation levels:

- `READ_UNCOMMITTED`: Lowest isolation, allows dirty reads
- `READ_COMMITTED`: Prevents dirty reads
- `REPEATABLE_READ`: Prevents non-repeatable reads
- `SERIALIZABLE`: Highest isolation, prevents phantom reads

The appropriate isolation level should be chosen based on the requirements of the action.

## Parallel Execution

Actions can be executed in parallel based on their dependencies:

- Independent actions are executed concurrently
- Actions with dependencies wait for their dependencies to complete
- Synchronization points (fork/join) coordinate complex parallel patterns
- Error handling strategies determine how failures affect dependent actions

This enables efficient execution of complex workflows with many actions.

## Distributed Processing

The distributed workflow engine enables event processing across multiple servers or processes:

1. **Event Persistence**: When a workflow event is triggered, it is persisted to the database and published to Redis Streams
2. **Worker Consumption**: Worker processes across different servers consume events from the stream
3. **Idempotent Processing**: Each event is processed exactly once, even if multiple workers attempt to process it
4. **Status Tracking**: Processing status is tracked in the database to prevent duplicate processing
5. **Fault Tolerance**: If a worker fails during processing, another worker can pick up the work

### Deployment Models

Several deployment models are supported:

1. **Single-Server, Multiple Processes**: Multiple worker processes on the same server
2. **Multiple Servers**: Workers distributed across multiple servers
3. **Kubernetes Deployment**: Workers deployed as pods in a Kubernetes cluster
4. **Serverless**: Workers deployed as serverless functions (with appropriate adaptations)

## Monitoring and Observability

The distributed workflow engine includes monitoring and observability features:

- Processing statistics (events processed, actions executed)
- Queue depth monitoring
- Worker health tracking
- Performance metrics
- Error tracking and reporting

These features enable operators to ensure the system is functioning correctly and to diagnose issues when they occur.

## Implementation Plan

The distributed workflow engine will be implemented in phases:

### Phase 1: Redis Streams Integration
- Create Redis Stream client for workflow events
- Define message schemas for workflow events
- Implement event publishing functionality

### Phase 2: Workflow Runtime Refactoring
- Split event processing into two phases:
  - `enqueueEvent`: Persist event and publish to Redis Streams
  - `processQueuedEvent`: Process event and execute actions
- Maintain backward compatibility during the transition

### Phase 3: Worker Service Implementation
- Create worker service for consuming events from Redis Streams
- Implement distributed processing logic
- Add health monitoring and reporting

### Phase 4: Deployment Configuration
- Configure multiple worker instances
- Implement monitoring and observability
- Document deployment patterns

## Future Enhancements

Planned enhancements to the distributed workflow engine include:

1. **Advanced Retry Strategies**: Configurable retry backoff and circuit breakers
2. **Workflow Versioning**: Support for workflow definition versioning
3. **Visual Workflow Designer**: UI for creating and editing workflows
4. **Workflow Insights**: Analytics dashboard for workflow performance
5. **External System Integration**: Pre-built connectors for common systems
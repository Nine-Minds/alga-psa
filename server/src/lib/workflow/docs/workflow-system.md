# Workflow System

## 1. Introduction and Philosophy

### Purpose and Vision

The workflow system is a robust, flexible engine designed to model, execute, and manage complex business processes. It provides a structured way to define state transitions, execute actions, and respond to events while maintaining a complete audit trail of all activities. The system is built on modern architectural principles to ensure reliability, scalability, and maintainability.

### Core Principles

The workflow system is built on several key principles:

1. **Event Sourcing**: The system uses event sourcing as its foundational pattern, where the state of a workflow is derived by replaying a sequence of events rather than storing the current state directly. This provides a complete audit trail and enables powerful time-travel debugging capabilities.

2. **Domain-Driven Design**: The workflow engine is designed to be a flexible tool that can model complex domain processes while keeping domain logic separate from the workflow infrastructure.

3. **Stateless Processing**: Core components like the state machine are designed to be stateless, making them easier to test, scale, and maintain.

4. **Idempotent Execution**: Actions are executed idempotently, ensuring that even if the same event is processed multiple times (e.g., due to retries), the outcome remains consistent.

5. **Parallel Execution**: The system supports executing actions in parallel based on explicit dependencies, enabling efficient processing of complex workflows.

6. **Distributed Architecture**: The system can operate in a distributed environment, with events processed asynchronously across multiple servers for improved scalability and fault tolerance.

### Key Benefits

- **Auditability**: Complete history of all events and state transitions
- **Flexibility**: Customizable workflows defined in a domain-specific language
- **Scalability**: Distributed processing with Redis Streams
- **Reliability**: Idempotent processing and robust error handling
- **Visibility**: Comprehensive monitoring and observability
- **Maintainability**: Clean separation of concerns and modular architecture

## 2. Architecture Overview

### System Components

The workflow system consists of the following major components:

1. **Workflow Definition Language (DSL)**: A domain-specific language for defining workflows, including states, events, actions, and transitions.

2. **State Machine**: A stateless component that processes events by replaying the event history to determine the current state and the actions to execute.

3. **Action Executor**: Executes actions in parallel based on their dependencies, with support for various error handling strategies.

4. **Action Registry**: Manages the registration and execution of actions, ensuring idempotent execution.

5. **Persistence Layer**: Stores workflow executions, events, action results, and other workflow-related data.

6. **Workflow Runtime**: Integrates the above components and provides the main API for interacting with the workflow system.

7. **Redis Streams Integration**: Enables asynchronous event distribution across multiple servers.

8. **Worker Service**: Processes events asynchronously from Redis Streams.

9. **Distributed Coordination**: Ensures reliable processing in a distributed environment.

### Data Flow

1. **Event Submission**:
   - A client submits an event for a workflow execution (e.g., "ApproveInvoice")
   - The event is validated against the current workflow state
   - The event is persisted to the database
   - In a distributed setup, the event is also published to Redis Streams

2. **Event Processing**:
   - The state machine replays all previous events to determine the current state
   - It evaluates the new event against the current state to determine if it's valid
   - If valid, it determines the next state and the actions to execute

3. **Action Execution**:
   - The action executor builds a dependency graph of actions
   - It executes actions in parallel based on their dependencies
   - Results are stored in the database
   - Any errors are handled according to the defined strategy

4. **State Update**:
   - After all actions are executed, the workflow's current state is updated
   - The complete event and its processing results are available for querying

### Persistence Model

The workflow system uses several database tables to store its data:

1. **workflow_executions**: Stores metadata about workflow instances
2. **workflow_events**: Stores the event log for each workflow execution
3. **workflow_action_results**: Tracks the results of action executions
4. **workflow_timers**: Manages workflow timers
5. **workflow_action_dependencies**: Stores dependencies between actions
6. **workflow_sync_points**: Manages synchronization points for parallel execution
7. **workflow_event_processing**: Tracks the processing status of events in a distributed setup

## 3. Workflow Definition Language

The workflow system includes a domain-specific language (DSL) for defining workflows. This language allows you to express states, events, actions, transitions, and other workflow elements in a declarative way.

### Basic Syntax

A workflow definition consists of several sections:

```
workflow InvoiceApproval {
  // States
  state draft;
  state submitted { available_actions: [Approve, Reject]; }
  state approved;
  state rejected;
  
  // Events
  event Submit;
  event Approve;
  event Reject;
  
  // Actions
  action SendNotification(recipient, message);
  action UpdateInvoiceStatus(status);
  
  // Transitions
  transition draft -> submitted on Submit {
    SendNotification(recipient: "manager", message: "Invoice submitted for approval");
    UpdateInvoiceStatus(status: "submitted");
  }
  
  transition submitted -> approved on Approve if role == "manager" {
    SendNotification(recipient: "accountant", message: "Invoice approved");
    UpdateInvoiceStatus(status: "approved");
  }
  
  transition submitted -> rejected on Reject if role == "manager" {
    SendNotification(recipient: "submitter", message: "Invoice rejected");
    UpdateInvoiceStatus(status: "rejected");
  }
}
```

### Advanced Constructs

#### Parallel Execution

```
transition submitted -> processing on Process {
  parallel {
    ValidateInvoice();
    CheckBudget();
    VerifyApprover();
  }
}
```

#### Fork-Join Patterns

```
transition processing -> reviewed on Complete {
  fork InvoiceReview {
    path FinancialReview {
      CheckFinancials();
      RecordFinancialReview();
    }
    path ComplianceReview {
      CheckCompliance();
      RecordComplianceReview();
    }
  }
  
  join InvoiceReview;
  
  FinalizeReview();
}
```

#### Action Dependencies

```
transition approved -> paid on Pay {
  GeneratePayment();
  RecordPayment() dependsOn [GeneratePayment];
  SendReceipt() dependsOn [RecordPayment];
}
```

#### Conditions

```
transition submitted -> approved on Approve if invoice.amount < 1000 or role == "senior_manager" {
  ApproveInvoice();
}
```

#### Timers

```
timer ReminderTimer(delay: "24h", repeat: "false");

state pending {
  on ReminderTimer {
    SendReminder(recipient: "approver", message: "Pending invoice requires your attention");
  }
}
```

#### Data Models

```
data InvoiceData {
  id: string;
  amount: number;
  submitter: string;
  approver: string;
  status: string;
}
```

## 4. Core Components

### State Machine

The state machine is responsible for processing events and determining the resulting state transitions and actions. It is designed to be stateless, deriving the current state by replaying all previous events.

Key features:
- Stateless event processing
- Condition evaluation with role-based permissions
- Deterministic state derivation
- Support for complex transitions

Example usage:

```typescript
const stateMachine = createStateMachine();
const result = stateMachine.processEvent(
  workflowDefinition,
  previousEvents,
  newEvent,
  contextData
);

if (result.isValid) {
  console.log(`Transitioning from ${result.previousState} to ${result.nextState}`);
  console.log(`Actions to execute: ${result.actionsToExecute.length}`);
} else {
  console.error(`Invalid event: ${result.errorMessage}`);
}
```

### Action Executor

The action executor is responsible for executing actions in parallel based on their dependencies. It supports various error handling strategies and ensures that actions are executed in the correct order.

Key features:
- Parallel execution based on dependencies
- Support for synchronization points (join operations)
- Error handling strategies (stop, continue, retry, compensate)
- Transaction management

Example usage:

```typescript
const actionExecutor = createActionExecutor();
const results = await actionExecutor.executeActions(
  actionsToExecute,
  event,
  tenant
);

console.log(`Executed ${results.length} actions`);
results.forEach(result => {
  if (result.success) {
    console.log(`Action ${result.actionName} succeeded: ${JSON.stringify(result.result)}`);
  } else {
    console.error(`Action ${result.actionName} failed: ${result.error}`);
  }
});
```

### Action Registry

The action registry manages the registration and execution of actions. It ensures that actions are executed idempotently and provides a way to define and validate action parameters.

Key features:
- Action registration with parameter validation
- Idempotent action execution
- Transaction isolation level support
- Built-in actions for common operations

Example usage:

```typescript
const registry = getActionRegistry();

// Register a custom action
registry.registerSimpleAction(
  'SendInvoiceEmail',
  'Send an email with invoice details',
  [
    { name: 'recipient', type: 'string', required: true },
    { name: 'invoiceId', type: 'string', required: true },
    { name: 'template', type: 'string', required: false, defaultValue: 'default' }
  ],
  async (params) => {
    // Implementation
    return { sent: true, timestamp: new Date().toISOString() };
  }
);

// Execute an action
const result = await registry.executeAction('SendInvoiceEmail', {
  tenant: 'acme',
  executionId: 'wf-123',
  eventId: 'evt-456',
  idempotencyKey: 'send-invoice-email-789',
  parameters: {
    recipient: 'customer@example.com',
    invoiceId: 'inv-123'
  }
});
```

### Workflow Runtime

The workflow runtime integrates the above components and provides the main API for interacting with the workflow system. It handles the loading of workflow definitions, the processing of events, and the execution of actions.

Key features:
- Workflow definition management
- Event processing and action execution
- Persistence of events and execution state
- Integration with domain logic

In the distributed architecture, the workflow runtime is extended to support:
- Two-phase event processing (enqueue and process)
- Redis Streams integration
- Distributed coordination

## 5. Distributed Architecture

The workflow system can operate in a distributed environment, with events processed asynchronously across multiple servers. This provides higher throughput, better fault tolerance, and improved scalability.

### Redis Streams Integration

Redis Streams is used as a message queue for distributing workflow events to workers. When a workflow event is submitted, it is:
1. Validated and persisted to the database
2. Published to Redis Streams for asynchronous processing
3. Processed by worker processes running across multiple servers

Key features:
- Consumer groups ensure each event is processed exactly once
- Message acknowledgment and claiming handle worker failures
- Proper error handling and retry mechanisms

### Two-Phase Event Processing

In the distributed architecture, event processing is split into two phases:
1. **Enqueue Phase**: Validate the event, persist it to the database, and publish it to Redis Streams
2. **Process Phase**: Consume the event from Redis Streams, process it using the state machine, and execute the resulting actions

This separation allows for immediate response to clients while ensuring reliable processing of events.

### Worker Service

The worker service consumes events from Redis Streams and processes them using the workflow runtime. It provides:
- Worker lifecycle management (startup, shutdown, health checks)
- Error handling with proper classification and retry logic
- Telemetry and logging for monitoring

For more details, see the [Worker Service Documentation](worker-service.md).

### Distributed Coordination

To ensure reliable processing in a distributed environment, the system uses:
- Redis-based distributed locks for critical sections
- Transaction management for cross-process coordination
- Error classification and recovery strategies

## 6. Usage Examples

### Basic Workflow Definition

```
workflow SimpleApproval {
  state draft;
  state submitted;
  state approved;
  state rejected;
  
  event Submit;
  event Approve;
  event Reject;
  
  action LogEvent(message);
  
  transition draft -> submitted on Submit {
    LogEvent(message: "Item submitted for approval");
  }
  
  transition submitted -> approved on Approve {
    LogEvent(message: "Item approved");
  }
  
  transition submitted -> rejected on Reject {
    LogEvent(message: "Item rejected");
  }
}
```

### Integration with Domain Logic

```typescript
import { getWorkflowRuntime } from '../lib/workflow/core/workflowRuntime';
import { loadWorkflowDefinition } from '../lib/workflow/core/workflowLoader';

// Initialize the workflow runtime
const runtime = getWorkflowRuntime();

// Load the workflow definition
const invoiceWorkflow = await loadWorkflowDefinition('InvoiceApproval');

// Register domain-specific actions
const registry = getActionRegistry();
registry.registerDatabaseAction(
  'UpdateInvoiceStatus',
  'Update the status of an invoice',
  [
    { name: 'invoiceId', type: 'string', required: true },
    { name: 'status', type: 'string', required: true }
  ],
  TransactionIsolationLevel.REPEATABLE_READ,
  async (params, context) => {
    const result = await context.transaction('invoices')
      .where('id', params.invoiceId)
      .update({ status: params.status });
    
    return { updated: result === 1 };
  }
);

// Start a new workflow execution
const executionId = await runtime.startWorkflow(
  'InvoiceApproval',
  'acme',
  { invoiceId: 'inv-123', amount: 500 }
);

// Submit an event
const result = await runtime.submitEvent({
  execution_id: executionId,
  event_name: 'Submit',
  payload: { submittedBy: 'user-456' },
  user_id: 'user-456',
  tenant: 'acme'
});

console.log(`Event processed: ${result.isValid}`);
console.log(`New state: ${result.nextState}`);
```

### Distributed Processing Example

```typescript
import { getWorkflowRuntime } from '../lib/workflow/core/workflowRuntime';

// Initialize the workflow runtime
const runtime = getWorkflowRuntime();

// Enqueue an event for asynchronous processing
await runtime.enqueueEvent({
  execution_id: 'wf-123',
  event_name: 'Approve',
  payload: { approvedBy: 'user-789' },
  user_id: 'user-789',
  tenant: 'acme'
});

// The event will be processed asynchronously by a worker
console.log('Event enqueued for processing');
```

## 7. Operational Considerations

### Monitoring

The workflow system provides several monitoring capabilities:

1. **Workflow Telemetry**: Counts, rates, and durations of workflow events and actions
2. **Event Tracing**: Correlation IDs for tracking events across the system
3. **Health Checks**: API endpoints for checking the health of the workflow system
4. **Logging**: Comprehensive logging of workflow activities

### Scaling

The workflow system can be scaled in several ways:

1. **Vertical Scaling**: Increase resources (CPU, memory) for the workflow runtime and worker processes
2. **Horizontal Scaling**: Add more worker processes across multiple servers
3. **Database Scaling**: Optimize database queries and indexes for efficient event loading and replay
4. **Redis Scaling**: Configure Redis for high availability and performance

### Troubleshooting

Common issues and their solutions:

1. **Events not being processed**:
   - Check Redis connection
   - Verify that events are being published to Redis Streams
   - Check for errors in the worker logs

2. **High event processing latency**:
   - Increase the number of workers
   - Optimize database queries
   - Check for resource bottlenecks

3. **Inconsistent workflow state**:
   - Verify that actions are idempotent
   - Check for distributed lock failures
   - Ensure that the event log is complete and ordered correctly

## 8. Future Enhancements

Planned enhancements for the workflow system include:

1. **Workflow Designer UI**: A visual tool for designing and testing workflows
2. **Enhanced Monitoring**: More detailed metrics and visualizations
3. **Advanced Error Recovery**: Automated recovery strategies for different error types
4. **Performance Optimizations**: Improved event replay and action execution
5. **Extended DSL Features**: More advanced constructs for complex workflows

## 9. Conclusion

The workflow system provides a powerful, flexible foundation for modeling and executing complex business processes. Its event-sourced architecture, parallel execution capabilities, and distributed processing make it suitable for a wide range of applications, from simple approval flows to complex multi-stage processes.

By separating the workflow infrastructure from domain logic, it enables clean, maintainable code while providing the reliability and auditability required for critical business processes.
# Workflow System

## 1. Introduction and Philosophy

> **Important Note on Workflow Execution**: Workflows are executed in response to events. When a workflow is triggered, the event that triggered it is passed as input to the workflow. The workflow does not wait for the initial event - the fact that the workflow is executing means the event has already occurred. This is reflected in the workflow examples where each workflow receives its triggering event via `context.input.triggerEvent`.

### Purpose and Vision

The workflow system is a robust, flexible engine designed to model, execute, and manage complex business processes. It provides a structured way to define business logic, execute actions, and respond to events while maintaining a complete audit trail of all activities. The system is built on modern architectural principles to ensure reliability, scalability, and maintainability.

The system uses a TypeScript-based approach to workflow definition, allowing developers to create workflows using familiar programming constructs while leveraging the type safety and tooling of TypeScript.

### Core Principles

The workflow system is built on several key principles:

1.  **Event Sourcing**: The system uses event sourcing as its foundational pattern, where the state of a workflow is derived by replaying a sequence of events rather than storing the current state directly. This provides a complete audit trail and enables powerful time-travel debugging capabilities.

2.  **Domain-Driven Design**: The workflow engine is designed to be a flexible tool that can model complex domain processes while keeping domain logic separate from the workflow infrastructure.

3.  **Programmatic Workflows**: Workflows are defined as TypeScript functions, allowing developers to use familiar programming constructs while maintaining the benefits of a structured workflow system.

4.  **Idempotent Execution**: Actions are executed idempotently, ensuring that even if the same event is processed multiple times (e.g., due to retries), the outcome remains consistent.

5.  **Parallel Execution**: The system supports executing actions in parallel based on explicit dependencies, enabling efficient processing of complex workflows.

6.  **Asynchronous Event Processing**: The system processes all events asynchronously through a message queue, providing improved scalability and fault tolerance.

### Key Benefits

- **Auditability**: Complete history of all events and workflow execution
- **Flexibility**: Customizable workflows defined in TypeScript
- **Scalability**: Distributed processing with Redis Streams
- **Reliability**: Idempotent processing and robust error handling
- **Visibility**: Comprehensive monitoring and observability
- **Maintainability**: Clean separation of concerns and modular architecture
- **Developer Experience**: Familiar TypeScript syntax with IDE support, type checking, and refactoring tools

## 2. Architecture Overview

### System Components

The workflow system consists of the following major components:

1.  **TypeScript Workflow Runtime**: Executes workflows defined as TypeScript functions, managing their state and event handling.

2.  **Action Executor**: Executes actions in parallel based on their dependencies, with support for various error handling strategies.

3.  **Action Registry**: Manages the registration and execution of actions, ensuring idempotent execution.

4.  **Persistence Layer**: Stores workflow executions, events, action results, and other workflow-related data.

5.  **Workflow Context**: Provides the execution context for workflows, including access to actions, data, events, and logging.

6.  **Redis Streams Integration**: Enables asynchronous event distribution across multiple servers.

7.  **Worker Service**: Processes events asynchronously from Redis Streams.

8.  **Distributed Coordination**: Ensures reliable processing in a distributed environment.

### Data Flow

1.  **Event Submission**:
    - A client publishes an event to the event bus (e.g., "INVOICE_CREATED")
    - The event is persisted to the database
    - The system identifies workflows attached to this event type
    - For each attached workflow, a new execution is created
    - In a distributed setup, the event is also published to Redis Streams

2.  **Event Processing**:
    - The workflow runtime processes the event within the context of the workflow function
    - The workflow function determines how to handle the event based on its current state
    - The workflow function may execute actions, update data, or change state

3.  **Action Execution**:
    - The action executor builds a dependency graph of actions
    - It executes actions in parallel based on their dependencies
    - Results are stored in the database
    - Any errors are handled according to the defined strategy

4.  **State Update**:
    - The workflow function updates its state based on the event and action results
    - The complete event and its processing results are available for querying

### System Workflows and Tenant-Specific Triggering

System workflows represent shared, reusable workflow definitions or templates that are available to all tenants within the platform. Examples of such workflows might include standard processes like `qboInvoiceSyncWorkflow` or other common business operations.

A key aspect to understand is how these system workflows are invoked. Contrary to a potential misunderstanding that they might be triggered by global, non-tenant-specific "system events" (e.g., via a hypothetical `system_workflow_event_attachments` table for such global triggers), system workflows like `qboInvoiceSyncWorkflow` are typically triggered in the context of a *specific tenant*.

The triggering mechanism relies on tenant-specific event attachments. When an event relevant to a system workflow (e.g., `INVOICE_UPDATED` for an invoice sync workflow) occurs for a particular tenant, the system consults the tenant-specific `workflow_event_attachments` table. An entry in this table links the `tenant_id`, the `event_type` (e.g., `INVOICE_UPDATED`), and the `workflow_id`. For a system workflow, this `workflow_id` corresponds to its `registration_id`, effectively associating the tenant-specific event with the shared system workflow definition.

This ensures that while the workflow *definition* is shared, its *execution* is always tied to a specific tenant and triggered by events occurring within that tenant's scope. If a table named `system_workflow_event_attachments` exists, its purpose would be distinct from this tenant-specific triggering mechanism for workflows like `qboInvoiceSyncWorkflow`. For these, the attachment and subsequent workflow execution are inherently tenant-specific.

### Persistence Model

The workflow system uses several database tables to store its data:

1.  **workflow_executions**: Stores metadata about workflow instances
2.  **workflow_events**: Stores the event log for each workflow execution
3.  **workflow_action_results**: Tracks the results of action executions
4.  **workflow_timers**: Manages workflow timers
5.  **workflow_action_dependencies**: Stores dependencies between actions
6.  **workflow_sync_points**: Manages synchronization points for parallel execution
7.  **workflow_event_processing**: Tracks the processing status of events in a distributed setup

## 3. TypeScript-Based Workflows

The workflow system uses TypeScript functions for defining workflows, providing a programmatic approach with full access to TypeScript's features.

#### Basic Structure

```typescript
async function workflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('initial');
  
  // Wait for events
  const startEvent = await events.waitFor('Start');
  
  // Execute actions
  await actions.doSomething({ param1: 'value1' });
  
  // Update state
  context.setState('completed');
}

```

#### Workflow Context

The `WorkflowContext` provides access to:

- **actions**: Proxy object for executing registered actions
- **data**: Data manager for storing and retrieving workflow data
- **events**: Event manager for waiting for and emitting events
- **logger**: Logger for workflow execution
- **setState/getCurrentState**: Methods for managing workflow state

#### Control Flow

TypeScript-based workflows use native language constructs for control flow:

```typescript
// Conditional logic
if (data.get<InvoiceData>('invoice').amount > 1000) {
  await actions.requireAdditionalApproval();
}

// Switch statements
switch (event.payload.status) {
  case 'approved':
    await actions.processApproval();
    break;
  case 'rejected':
    await actions.processRejection();
    break;
  default:
    throw new Error('Invalid status');
}

// Loops
for (const item of data.get<Order>('order').items) {
  await actions.processItem(item);
}
```

#### Parallel Execution

```typescript
// Execute actions in parallel
await Promise.all([
  actions.validateInvoice(),
  actions.checkBudget(),
  actions.verifyApprover()
]);
```

#### Error Handling

```typescript
try {
  await actions.riskyOperation();
} catch (error) {
  logger.error('Operation failed', error);
  await actions.handleFailure();
}
```

## 4. Core Components

### TypeScript Workflow Runtime

The TypeScript Workflow Runtime is responsible for executing workflows defined as TypeScript functions. It manages workflow state, processes events, and provides the execution context for workflows.

Key features:
- Workflow registration and execution
- Event handling and processing
- State management
- Action execution coordination
- Data persistence

Example usage:

```typescript
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { invoiceApprovalWorkflow } from '../workflows/invoiceApprovalWorkflow';

// Initialize the workflow runtime
const runtime = getWorkflowRuntime();

// Register a workflow
runtime.registerWorkflow(invoiceApprovalWorkflow);

// Start a new workflow execution
const executionId = await runtime.startWorkflow(
  'InvoiceApproval',
  {
    tenant: 'acme',
    initialData: {
      invoice: {
        id: 'inv-123',
        amount: 500,
        status: 'draft'
      }
    }
  }
);

// Option 1: Enqueue an event for a specific workflow execution
await runtime.enqueueEvent({
  execution_id: executionId,
  event_name: 'Submit',
  payload: { submittedBy: 'user-456' },
  user_id: 'user-456',
  tenant: 'acme'
});

// Option 2: Publish an event to the event bus to trigger attached workflows
await submitWorkflowEventAction({
  event_name: 'INVOICE_SUBMITTED',
  event_type: 'INVOICE_SUBMITTED',
  payload: {
    invoiceId: 'inv-123',
    submittedBy: 'user-456'
  }
});
```

### Workflow Context

The Workflow Context provides the execution environment for workflows, giving them access to actions, data, events, and logging capabilities.

Key features:
- Action execution through a proxy object
- Data storage and retrieval
- Event waiting and emission
- Logging and debugging
- State management

Example usage within a workflow function:

```typescript
async function invoiceApprovalWorkflow(context: WorkflowContext) {
  const { actions, data, events, logger, setState } = context;
  
  // Set initial state
  setState('draft');
  
  // Store workflow data
  data.set('invoice', { id: 'inv-123', amount: 500, status: 'draft' });
  
  // Wait for an event
  const submitEvent = await events.waitFor('Submit');
  logger.info(`Invoice submitted by ${submitEvent.user_id}`);
  
  // Execute an action
  await actions.sendNotification({
    recipient: 'manager',
    message: 'Invoice submitted for approval'
  });
  
  // Update state
  setState('submitted');
  
  // Wait for approval or rejection
  const decisionEvent = await events.waitFor(['Approve', 'Reject']);
  
  if (decisionEvent.name === 'Approve') {
    await actions.updateInvoiceStatus({ status: 'approved' });
    setState('approved');
  } else {
    await actions.updateInvoiceStatus({ status: 'rejected' });
    setState('rejected');
  }
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

## 5. Asynchronous Event Processing

The workflow system processes all events asynchronously through a message queue. This provides higher throughput, better fault tolerance, and improved scalability.

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

Event processing is split into two phases:
1. **Enqueue Phase**: Validate the event, persist it to the database, and publish it to Redis Streams
2. **Process Phase**: Consume the event from Redis Streams, process it using the workflow runtime, and execute the resulting actions

This separation allows for immediate response to clients while ensuring reliable processing of events.

### Worker Service

The worker service consumes events from Redis Streams and processes them using the workflow runtime. It provides:
- Worker lifecycle management (startup, shutdown, health checks)
- Error handling with proper classification and retry logic
- Telemetry and logging for monitoring

For more details, see the [Worker Service Documentation](worker-service.md).

### Reliable Processing

To ensure reliable event processing, the system uses:
- Redis-based locks for critical sections
- Transaction management for data consistency
- Error classification and recovery strategies

## 6. Usage Examples

### Basic TypeScript Workflow Definition

```typescript
async function approvalWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, logger } = context;
  
  // Initial state - Processing
  context.setState('processing');
  logger.info('Workflow started in processing state');
  
  // The workflow is triggered by a Submit event, which is passed as input
  const { triggerEvent } = context.input;
  logger.info(`Processing submission from ${triggerEvent.user_id}`);
  
  await actions.log_event({ message: "Item submitted for approval" });
  context.setState('submitted');
  
  // Wait for Approve or Reject event
  const decisionEvent = await events.waitFor(['Approve', 'Reject']);
  
  if (decisionEvent.name === 'Approve') {
    await actions.log_event({ message: "Item approved" });
    context.setState('approved');
  } else {
    await actions.log_event({ message: "Item rejected" });
    context.setState('rejected');
  }
  
  logger.info('Workflow completed');
}
```


### Asynchronous Event Processing Example

```typescript
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';

// Initialize the workflow runtime
const runtime = getWorkflowRuntime();

// Option 1: Enqueue an event for a specific workflow execution
await runtime.enqueueEvent({
  execution_id: 'wf-123',
  event_name: 'Approve',
  payload: { approvedBy: 'user-789' },
  user_id: 'user-789',
  tenant: 'acme'
});

// Option 2: Publish an event to the event bus to trigger attached workflows
await submitWorkflowEventAction({
  event_type: 'INVOICE_APPROVED',
  payload: {
    invoiceId: 'inv-123',
    approvedBy: 'user-789'
  }
});

// The event will be processed asynchronously by a worker
console.log('Event enqueued for processing');
```

## 7. Operational Considerations

### Monitoring

The workflow system provides several monitoring capabilities:

1.  **Workflow Telemetry**: Counts, rates, and durations of workflow events and actions
2.  **Event Tracing**: Correlation IDs for tracking events across the system
3.  **Health Checks**: API endpoints for checking the health of the workflow system
4.  **Logging**: Comprehensive logging of workflow activities

### Scaling

The workflow system can be scaled in several ways:

1.  **Vertical Scaling**: Increase resources (CPU, memory) for the workflow runtime and worker processes
2.  **Horizontal Scaling**: Add more worker processes across multiple servers
3.  **Database Scaling**: Optimize database queries and indexes for efficient event loading and replay
4.  **Redis Scaling**: Configure Redis for high availability and performance

### Troubleshooting

Common issues and their solutions:

1.  **Events not being processed**:
    - Check Redis connection
    - Verify that events are being published to Redis Streams
    - Check for errors in the worker logs

2.  **High event processing latency**:
    - Increase the number of workers
    - Optimize database queries
    - Check for resource bottlenecks

3.  **Inconsistent workflow state**:
    - Verify that actions are idempotent
    - Check for distributed lock failures
    - Ensure that the event log is complete and ordered correctly

### Integration with Domain Logic

```typescript
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { getActionRegistry } from '@shared/workflow/core/actionRegistry';
import { invoiceApprovalWorkflow } from '../workflows/invoiceApprovalWorkflow';

// Initialize the action registry
const registry = getActionRegistry();

// Register domain-specific actions
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

// Initialize the workflow runtime
const runtime = getWorkflowRuntime(registry);

// Register the TypeScript workflow
runtime.registerWorkflow(invoiceApprovalWorkflow);

// Start a new workflow execution
const executionId = await runtime.startWorkflow(
  'InvoiceApproval',
  {
    tenant: 'acme',
    initialData: {
      invoice: {
        id: 'inv-123',
        amount: 500,
        status: 'draft'
      }
    }
  }
);

// Enqueue an event
await runtime.enqueueEvent({
  execution_id: executionId,
  event_name: 'Submit',
  payload: { submittedBy: 'user-456' },
  user_id: 'user-456',
  tenant: 'acme'
});
```

## 8. Future Enhancements

Planned enhancements for the workflow system include:

1.  **Workflow Designer UI**: A visual tool for designing and testing TypeScript workflows
2.  **Enhanced Monitoring**: More detailed metrics and visualizations
3.  **Advanced Error Recovery**: Automated recovery strategies for different error types
4.  **Performance Optimizations**: Improved event processing and action execution
5.  **TypeScript Workflow Analyzer**: Improved static analysis of TypeScript workflows for visualization and validation
6.  **Workflow Templates**: Reusable workflow patterns and templates
7.  **Enhanced Testing Tools**: Specialized tools for testing and debugging workflows

## 9. Conclusion

The workflow system provides a powerful, flexible foundation for modeling and executing complex business processes. Its event-sourced architecture, parallel execution capabilities, and distributed processing make it suitable for a wide range of applications, from simple approval flows to complex multi-stage processes.

The TypeScript-based workflow approach offers several key advantages:

1.  **Familiar Programming Model**: Developers can use the full power of TypeScript, including its type system, control flow constructs, and error handling.

2.  **IDE Support**: Full IDE support including code completion, refactoring, and navigation.

3.  **Testability**: Workflows can be unit tested like any other TypeScript code.

4.  **Flexibility**: Complex business logic can be expressed naturally using programming constructs.

5.  **Maintainability**: Standard software engineering practices can be applied to workflow code.

By separating the workflow infrastructure from domain logic, the system enables clean, maintainable code while providing the reliability and auditability required for critical business processes.

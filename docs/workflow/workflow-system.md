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

6.  **Redis Streams Integration**: Enables asynchronous event distribution. Currently, all workflow-related events are published to a single global Redis stream named `workflow:events:global`. (See Section 5 for more details on event stream usage).

7.  **Worker Service**: Processes events asynchronously from Redis Streams.
    *   **Current Architecture**: The `WorkflowWorker` currently operates as a singleton instance. This means all events from the global Redis stream are processed by this single worker. This is important for understanding how features like `context.events.waitFor` function reliably with in-memory listeners.
    *   **Future Scalability**: Future plans for scaling may involve distributing workers, potentially by sharding streams by tenant ID (e.g., `workflow:events:tenant_hash_X`). This approach would aim to maintain worker affinity for workflow executions within a tenant, preserving the effectiveness of in-memory event listeners. If a different distribution model is adopted where affinity is not guaranteed, the in-memory listener mechanism for `context.events.waitFor` would require re-evaluation.

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

System workflows represent shared, reusable workflow definitions or templates that are available to all tenants within the platform. Examples might include standard processes like a generic `invoiceLifecycleWorkflow` or other common business operations.

A key aspect to understand is how these system workflows are invoked. Contrary to a potential misunderstanding that they might be triggered by global, non-tenant-specific \"system events\" (e.g., via a hypothetical `system_workflow_event_attachments` table for such global triggers), system workflows such as the invoice lifecycle example are typically triggered in the context of a *specific tenant*.

The triggering mechanism relies on tenant-specific event attachments. When an event relevant to a system workflow (e.g., `INVOICE_UPDATED` for an invoice sync workflow) occurs for a particular tenant, the system consults the tenant-specific `workflow_event_attachments` table. An entry in this table links the `tenant_id`, the `event_type` (e.g., `INVOICE_UPDATED`), and the `workflow_id`. For a system workflow, this `workflow_id` corresponds to its `registration_id`, effectively associating the tenant-specific event with the shared system workflow definition.

This ensures that while the workflow *definition* is shared, its *execution* is always tied to a specific tenant and triggered by events occurring within that tenant's scope. If a table named `system_workflow_event_attachments` exists, its purpose would be distinct from this tenant-specific triggering mechanism. For tenant-aware workflows, the attachment and subsequent execution remain tenant-specific.

### Persistence Model

The workflow system uses several database tables to store its data:

1.  **workflow_executions**: Stores metadata about workflow instances
2.  **workflow_events**: Stores the event log for each workflow execution
3.  **workflow_action_results**: Tracks the results of action executions
4.  **workflow_timers**: Manages workflow timers
5.  **workflow_action_dependencies**: Stores dependencies between actions
6.  **workflow_sync_points**: Manages synchronization points for parallel execution
7.  **workflow_event_processing**: Tracks the detailed lifecycle and processing status of individual events intended for asynchronous handling. When an event is enqueued (e.g., via `runtime.enqueueEvent()`), a record is created here. Its status transitions typically from `pending` -> `published` (to Redis) -> `processing` (by a worker) -> `completed` or `failed`. This table is crucial for ensuring event processing reliability, enabling retries, and providing visibility into the asynchronous event pipeline, especially in distributed environments. It links to `workflow_events` via `event_id`.
8.  **system_workflow_task_definitions**: Stores definitions for system-wide, reusable task types (e.g., common error handling tasks). These definitions are not tenant-specific and are identified by their `task_type` string. They link to form definitions (often system forms).
9.  **workflow_task_definitions**: Stores definitions for task types that are specific to a tenant. These are identified by a UUID (`task_definition_id`) and are scoped to a `tenant`.
10. **workflow_tasks**: Stores instances of human tasks. It links to its definition using:
    - `task_definition_type` ('system' or 'tenant'): Indicates whether the task uses a system or tenant-specific definition.
    - `tenant_task_definition_id` (UUID): Foreign key to `workflow_task_definitions.task_definition_id` if type is 'tenant'.
    - `system_task_definition_task_type` (TEXT): Foreign key to `system_workflow_task_definitions.task_type` if type is 'system'.

11. **system_workflow_form_definitions**: Stores definitions for system-wide, reusable UI forms. These are referenced by task definitions. Key fields include `name` (unique identifier for the form), `json_schema` (defines the data structure and properties of the form), and `ui_schema` (provides hints for rendering the form).
12. **workflow_form_definitions**: Stores tenant-specific UI form definitions, mirroring the structure of `system_workflow_form_definitions`.

### Human Task Forms and Dynamic Data Display

Human tasks often require displaying dynamic information to the user based on the workflow's current context and the specifics of the task (e.g., error details, entity identifiers). The workflow system facilitates this through the interaction of form definitions (`system_workflow_form_definitions` or `workflow_form_definitions`) and the `contextData` provided when a human task is created via `actions.createHumanTask`.

There are two primary ways dynamic data is presented in forms:

1.  **Direct Field Population**:
    *   The form's `json_schema` defines distinct properties corresponding to individual pieces of data (e.g., `resolutionNotes`, `retryCheckbox`).
    *   The workflow provides values for these properties directly within the `contextData` object when creating the task. For example:
        ```typescript
        // In the workflow:
        await actions.createHumanTask({
          taskType: 'some_review_task',
          // ... other task parameters
          contextData: {
            resolutionNotes: "Initial assessment complete.",
            isUrgent: true
          }
        });
        ```
    *   The UI rendering layer then uses these values to populate the corresponding input fields (e.g., a textarea for `resolutionNotes`, a checkbox for `isUrgent`).

2.  **Template String Substitution**:
    *   This method is particularly useful for displaying formatted, read-only information composed of multiple data points, or for providing descriptive text that includes dynamic values.
    *   In the form's `json_schema` (stored in `system_workflow_form_definitions`), a property (often read-only) can have its `default` value set to a template string. This template string includes placeholders that reference keys within the `contextData` object, using the syntax `${contextData.keyName}`.
    *   Example `json_schema` property for a form definition:
        ```json
        {
          // ... other properties ...
          "errorReport": {
            "type": "string",
            "title": "Error Details",
            "readOnly": true,
            "default": "Workflow Instance ID: ${contextData.workflowInstanceId}\nError Code: ${contextData.errorCode}\nMessage: ${contextData.errorMessageText}\nEntity: ${contextData.entityType} (ID: ${contextData.entityId})"
          }
          // ...
        }
        ```
    *   The workflow, when creating the human task, populates the `contextData` with the individual data elements whose keys match the placeholders in the template.
        ```typescript
        // In the workflow, when an error occurs:
        await actions.createHumanTask({
          taskType: 'accounting_export_error', // This task type would link to the form definition above
          title: 'QuickBooks Sync Error',
          // ... other task parameters
          contextData: {
            workflowInstanceId: executionId,
            errorCode: 'QBO-123',
            errorMessageText: 'Customer not found in QBO.',
            entityType: 'Customer',
            entityId: algaCompanyId,
            // ... any other data needed by the template or for other purposes
          }
        });
        ```
    *   The UI rendering layer is then responsible for:
        1.  Retrieving the form definition (including the `json_schema` with the template string in the `default` value of the `errorReport` property).
        2.  Accessing the `contextData` associated with the specific task instance.
        3.  Performing string substitution on the template string, replacing placeholders like `${contextData.errorCode}` with their corresponding values from the `contextData` (e.g., "QBO-123").
        4.  Displaying the resulting formatted string to the user (e.g., in a read-only textarea as specified by the `ui_schema`).
    *   This pattern allows for flexible and descriptive presentation of dynamic information without requiring a separate form field for every individual piece of data if they are only for display. The `accounting-mapping-error-form` example's `productDetails` field demonstrates this approach.

**Key Considerations for Template Substitution:**
*   The workflow must ensure that all keys referenced in the form's template string are present in the `contextData` it provides when creating the task.
*   The UI component responsible for rendering the form must implement the logic to perform this substitution.
*   This method is best suited for read-only display of information. If user input is required for these individual pieces of data, direct field population (Method 1) is more appropriate.
#### Enhanced Templating for Dynamic Content

To provide more flexibility while maintaining security for user-influenced template strings (e.g., in form `default` values or dynamic UI text), the templating mechanism described above is being enhanced. This enhancement will utilize the existing Parsimmon dependency to parse and evaluate a controlled, limited set of JavaScript-like expressions within the `${...}` syntax.

**Key features of the enhanced templating:**
*   **Parser:** Implemented using Parsimmon.
*   **Supported Expressions (Initial Scope):**
    *   Variable access: `variableName` or `contextData.variableName`
    *   String literals: `'some string'`
    *   Logical OR: `expression1 || expression2`
    *   Date formatting: `new Date(variableOrString).toLocaleDateString()` and `new Date(variableOrString).toLocaleString()`
*   **Security:** The custom parser and evaluator are designed to be secure by only allowing the explicitly defined expressions and operations, preventing arbitrary code execution.
*   **Integration:** This will affect how `default` values in JSON schemas and other templated strings are processed by `server/src/utils/templateUtils.ts`, impacting components like `DynamicForm.tsx` and `ActivityDetailViewerDrawer.tsx`.

For a detailed technical design of this Parsimmon-based templating engine, please refer to "[`docs/technical/parsimmon_templating_engine.md`](../technical/parsimmon_templating_engine.md)".

By understanding these data flow patterns, developers can effectively design workflows that create informative and actionable human tasks.

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
  
  // Execute actions, including the new composite action
  // await actions.doSomething({ param1: 'value1' });
  // Example of the new action:
  // const taskOutcome = await actions.createTaskAndWaitForResult({
  //   taskType: 'user_review',
  //   title: 'Review Item',
  //   contextData: { itemId: '123' }
  // });
  // if (taskOutcome.success) {
  //   logger.info(`Task resolved with: ${JSON.stringify(taskOutcome.resolutionData)}`);
  // }
  
  // Update state
  context.setState('completed');
}

```

#### Workflow Context

The `WorkflowContext` provides access to:

- **actions**: Proxy object for executing registered actions. This now includes a powerful composite action `createTaskAndWaitForResult` which simplifies creating a human task and pausing the workflow until it's resolved.
- **data**: Data manager for storing and retrieving workflow data
- **events**: Event manager for waiting for and emitting events.
  - `events.waitFor()`: Pauses workflow execution until a specified external event (or one of several specified events) occurs. It relies on in-memory listeners within the `TypeScriptWorkflowRuntime` instance processing the workflow. Given the current singleton `WorkflowWorker` architecture (see Section 2), these in-memory listeners are effective as the same worker instance that initiates the wait will process the resolving event. This mechanism is crucial for the `actions.createTaskAndWaitForResult` composite action.
  - `events.emit()`: Asynchronously enqueues an event, which will be persisted and published to the global Redis stream for processing by the worker.
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
// For errors that are recoverable with human intervention, a more interactive pattern involves creating a human task and then pausing the workflow until the task is resolved, allowing the operation to be retried. The `actions.createTaskAndWaitForResult` method greatly simplifies this. See the "Interactive Error Resolution and Retries with Human Tasks" section for a detailed example.
```

#### Interactive Error Resolution and Retries with Human Tasks

A common and powerful pattern for handling operations that might fail due to issues requiring manual intervention (e.g., missing data, incorrect configuration, external system errors) is to:
1. Attempt the operation.
2. If it fails, use `actions.createTaskAndWaitForResult` to create a human task and automatically pause the workflow. This action encapsulates creating the task, determining the correct event to wait for (typically `TaskEventNames.taskCompleted(taskId)`), and then calling `context.events.waitFor()`.
3. The workflow resumes when `createTaskAndWaitForResult` returns, providing the outcome of the human task (e.g., data submitted by the user, or a timeout indication).
4. Based on the task's outcome, the workflow can retry the operation or take other actions.

This allows the workflow to remain in context and continue from where it left off, rather than terminating and requiring a full restart.

**Conceptual Flow (Simplified with `createTaskAndWaitForResult`):**

```
loop until operation_succeeds or max_retries_reached:
    try:
        perform_operation()
        operation_succeeds = true
    catch error_requiring_human_intervention:
        task_outcome = await actions.createTaskAndWaitForResult(
            taskType: 'resolve_error_X',
            title: 'Resolve Error for Operation Y',
            contextData: { error_details, relevant_ids },
            waitForEventTimeoutMilliseconds: 3_600_000 // Optional: 1 hour timeout
        )
        if task_outcome.success and task_outcome.resolutionData?.userFixedTheProblem:
            // Loop continues, operation will be retried
            logger.info("User indicated problem resolved. Retrying operation.")
        else:
            logger.warn("Task did not result in a successful resolution. Aborting retry.")
            // Handle non-resolution (e.g., log, escalate, break loop)
            break
```

**Example: Processing an item that requires a valid mapping (using `createTaskAndWaitForResult`)**

```typescript
async function processItemWithMappingWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, logger, setState, executionId } = context; // `events` is not directly needed here
  const itemId = data.get('itemIdToProcess');
  let itemProcessed = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 3; // Define a retry limit

  setState('VALIDATING_ITEM_MAPPING');

  while (!itemProcessed && attempts < MAX_ATTEMPTS) {
    attempts++;
    logger.info(`Attempt ${attempts} to process item ${itemId}.`);

    try {
      // Action that might fail if mapping is missing or invalid
      const mappingDetails = await actions.getMappingForItem({ itemId }); 
      if (!mappingDetails || !mappingDetails.isValid) {
        throw new Error(`Mapping for item ${itemId} is missing or invalid.`);
      }

      // Proceed with processing using mappingDetails
      await actions.processItemUsingMapping({ itemId, mappingDetails });
      itemProcessed = true;
      logger.info(`Item ${itemId} processed successfully.`);
      setState('ITEM_PROCESSING_COMPLETE');

    } catch (error: any) {
      logger.error(`Error processing item ${itemId} on attempt ${attempts}: ${error.message}`);
      setState(`AWAITING_MAPPING_RESOLUTION_FOR_ITEM_${itemId}_ATTEMPT_${attempts}`);

      // Use the new composite action to create a task and wait for its resolution
      const taskResolution = await actions.createTaskAndWaitForResult({
        taskType: 'resolve_item_mapping_error', // Links to a pre-defined task and form
        title: `Resolve Mapping for Item ${itemId} (Attempt ${attempts})`,
        description: `Error: ${error.message}. Please review and correct the mapping for item ID: ${itemId}.`,
        contextData: { // Data for the form and task context
          itemId: itemId,
          errorMessage: error.message,
          currentAttempt: attempts,
          maxAttempts: MAX_ATTEMPTS,
          workflowInstanceId: executionId
        },
        // Optional: Timeout for waiting for the task resolution event
        // waitForEventTimeoutMilliseconds: 60 * 60 * 1000 // 1 hour
      });

      if (taskResolution.success) {
        // Task was completed, event was received.
        // The payload of the event (taskResolution.resolutionData) might contain user input.
        logger.info(`Task ${taskResolution.taskId} for item ${itemId} resolved. Resolution data: ${JSON.stringify(taskResolution.resolutionData)}. Retrying processing.`);
        // The loop will continue, and getMappingForItem will be re-attempted.
      } else {
        // Task creation might have failed, or waitFor event might have timed out or errored.
        logger.error(`Failed to get resolution for task for item ${itemId}. Error: ${taskResolution.error}. Details: ${JSON.stringify(taskResolution.details)}. Halting retries for this item.`);
        setState('CRITICAL_ERROR_TASK_RESOLUTION_FAILED');
        // Depending on policy, you might throw an error here or return
        return; 
      }
    }
  } // End while loop

  if (!itemProcessed) {
    logger.error(`Failed to process item ${itemId} after ${MAX_ATTEMPTS} attempts.`);
    setState('ITEM_PROCESSING_FAILED_MAX_ATTEMPTS');
    // Optionally, create a final escalation task or take other compensatory actions.
    // Can still use createHumanTask directly if no waiting is needed, or createTaskAndWaitForResult if it is.
    await actions.createHumanTask({ 
        taskType: 'item_processing_escalation',
        title: `Escalation: Item ${itemId} processing failed after max attempts.`,
        contextData: { itemId, attempts, workflowInstanceId: executionId }
    });
  }
}
```

**Key Considerations for `actions.createTaskAndWaitForResult`:**
*   **Simplicity**: This action significantly simplifies the workflow code by encapsulating the `createHumanTask` call, event name construction (it uses `TaskEventNames.taskCompleted(taskId)` internally), and the `events.waitFor()` call.
*   **Return Value**: The action returns an object (`CreateTaskAndWaitForResultReturn`) indicating `success` (boolean), the `taskId` (string | null), `resolutionData` (any, the payload of the task completion event), and an optional `error` message or `details` object.
*   **Task Resolution Event**: The system relies on an event named according to `TaskEventNames.taskCompleted(taskId)` being emitted when the human task is resolved. This is a standard convention.
*   **Retry Limits**: Always include a mechanism (like a maximum attempt counter) to prevent infinite loops.
*   **Idempotency**: Ensure retried operations are idempotent.
*   **`setState` for Observability**: Continue to use `context.setState()` for visibility.
*   **Timeout**: The `waitForEventTimeoutMilliseconds` parameter in `createTaskAndWaitForResultParams` allows specifying a timeout for how long the workflow will wait for the task resolution event. If a timeout occurs, `taskResolution.success` will be `false`, and `taskResolution.error` will indicate a timeout.
*   **Detailed Event Flow**:
    1.  `createTaskAndWaitForResult` internally calls the registered `actions.create_human_task` action.
    2.  This action (or its underlying logic) creates the human task record in the database.
    3.  `createTaskAndWaitForResult` then determines the expected resolution event name (typically `TaskEventNames.taskCompleted(taskId)`) and calls `context.events.waitFor()` with this event name, causing the workflow to pause.
    4.  When the human task is completed (e.g., through a UI interaction that calls an API like `submitTaskForm`):
        a.  The API endpoint handling task completion (e.g., `submitTaskForm`) is responsible for emitting the task resolution event (e.g., `TASK_COMPLETED` with the `taskId` and resolution data in its payload).
        b.  This event is enqueued using `runtime.enqueueEvent()`.
        c.  `enqueueEvent()` persists the event to the database (e.g., `workflow_events` table) and publishes it to the global Redis stream (`workflow:events:global`).
        d.  The singleton `WorkflowWorker` consumes this event from the Redis stream.
        e.  The worker invokes `runtime.processQueuedEvent()` for the consumed event.
        f.  `processQueuedEvent()` loads the relevant workflow execution state, applies the event, and then calls `notifyEventListeners()`.
        g.  `notifyEventListeners()` finds the specific in-memory listener registered by the earlier `context.events.waitFor()` call (within the same worker process) and resolves the associated promise.
        h.  This resolution allows `createTaskAndWaitForResult` to resume, and it then returns the task outcome (including `resolutionData` from the event payload) to the workflow.

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

Redis Streams is used as the message queue for distributing workflow events.

**Global Event Stream**: Currently, all workflow-related events—including initial trigger events, events emitted by workflows via `context.events.emit()`, and task completion events—are published to a single global Redis stream named `workflow:events:global`. The `WorkflowWorker` (currently a singleton instance) consumes events from this global stream.

**Event Publication Flow**: When a workflow event is submitted (e.g., via `runtime.enqueueEvent()`):
1. The event is validated and persisted to the database (e.g., into `workflow_events` and `workflow_event_processing` tables).
2. It is then published as a message to the `workflow:events:global` Redis stream for asynchronous processing.
3. Worker processes (currently one) consume messages from this stream.

**Key Features Leveraged**:
- **Consumer Groups**: Can be used to ensure each event message is processed by one consumer in a group (relevant for future multi-worker scenarios).
- **Message Acknowledgment**: Helps in handling worker failures and ensuring events are not lost.
- **Error Handling**: The system includes mechanisms for retrying event processing in case of transient failures.

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
- Redis-based locks for critical sections (e.g., during event processing by a worker).
- Transaction management for data consistency (e.g., when persisting events and updating workflow state).
- Error classification and recovery strategies for handling failures during event processing.
- **Standardized Identifiers**: Key identifiers such as `event_id` in the `workflow_events` table and `processing_id` in the `workflow_event_processing` table are expected to be standard Universally Unique Identifiers (UUIDs). If idempotency keys are provided and used as `event_id`, they should also conform to the UUID format or be handled by a system layer that ensures compatibility with database constraints (e.g., by hashing or mapping if the underlying column type is strictly UUID). This ensures data integrity and compatibility with database functions expecting UUIDs.

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

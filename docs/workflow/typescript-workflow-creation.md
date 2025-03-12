# TypeScript Workflow Creation Guide

## 1. Introduction

The Automation Hub provides a powerful TypeScript-based workflow system that allows you to create, manage, and execute custom business processes. This guide will walk you through the process of creating workflows using TypeScript, from basic concepts to advanced patterns.

> **Important Note on Workflow Execution**: Workflows are executed in response to events. When a workflow is triggered, the event that triggered it is passed as input to the workflow. The workflow does not wait for the initial event - the fact that the workflow is executing means the event has already occurred. This is reflected in the workflow examples where each workflow receives its triggering event via `context.input.triggerEvent`.

## 2. Getting Started

### Accessing the Workflow Editor

1. Navigate to the Automation Hub in the main navigation menu
2. Select the "Workflows" tab
3. Click the "Create Workflow" button to open the workflow editor
4. Alternatively, you can start from a template by clicking "Browse Templates" and selecting a template

### Workflow Editor Interface

The workflow editor consists of several key components:

- **Metadata Section**: Fields for workflow name, description, version, tags, and active status
- **TypeScript Editor**: Monaco-based code editor with TypeScript support
- **Validation Warnings**: Real-time feedback on potential issues in your workflow code
- **Action Buttons**: Save and Test buttons to manage your workflow

## 3. Workflow Structure

### Basic Structure

Workflows are defined as standalone async functions that take a WorkflowContext parameter. These functions are stored in the database and executed by the workflow runtime.

```typescript
/**
 * My workflow function
 *
 * @param context The workflow context provided by the runtime
 */
async function myWorkflow(context: WorkflowContext): Promise<void> {
  // Workflow implementation
}
```

### Workflow Context

The workflow context provides access to various capabilities:

- **actions**: Execute registered actions
- **data**: Store and retrieve workflow data
- **events**: Emit events
- **logger**: Log information for debugging and monitoring
- **input**: Access the trigger event and parameters
- **setState/getCurrentState**: Manage workflow state

```typescript
async function workflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('initial');
  
  // Log information
  logger.info('Workflow started');
  
  // Store data
  data.set('startTime', new Date().toISOString());
  
  // Access the trigger event
  const event = context.input.triggerEvent;
  
  // Execute actions
  const result = await actions.someAction({ param: 'value' });
  
  // Final state
  context.setState('completed');
}
```

## 4. Core Concepts

### State Management

Workflows use states to track their progress. Always set an initial state and update it as the workflow progresses.

```typescript
// Set initial state
context.setState('initial');

// Later in the workflow
context.setState('processing');

// Get current state
const currentState = context.getCurrentState();

// Final state
context.setState('completed');
```

### Event Handling

Events drive workflow progression. Each workflow execution is triggered by an event, which is accessible via the context.input.triggerEvent property.

```typescript
// Access the trigger event
const triggerEvent = context.input.triggerEvent;

// Check the event type
if (triggerEvent.name === 'ApproveRequest') {
  // Handle approval request
  logger.info('Processing approval request', triggerEvent.payload);
} else if (triggerEvent.name === 'RejectRequest') {
  // Handle rejection request
  logger.info('Processing rejection request', triggerEvent.payload);
}

// You can also emit events
await events.emit('ProcessingStarted', { requestId: triggerEvent.payload.id });
```

### Data Management

Store and retrieve data within the workflow context.

```typescript
// Store data
data.set('requestData', { id: '123', amount: 500 });

// Retrieve data with type safety
const requestData = data.get<{ id: string, amount: number }>('requestData');
```

### Action Execution

Actions are the primary way to interact with external systems.

```typescript
// Execute an action
const result = await actions.updateRecord({
  recordId: '123',
  status: 'approved'
});

// Handle the result
logger.info('Record updated', result);
```

### Error Handling

Always include error handling in your workflows to ensure robustness.

```typescript
try {
  const result = await actions.riskyOperation();
  context.setState('success');
} catch (error) {
  logger.error('Operation failed', error);
  context.setState('error');
  
  // Store error information
  data.set('error', {
    message: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString()
  });
}
```

## 5. Advanced Patterns

### Parallel Execution

Execute multiple actions in parallel for improved performance.

```typescript
// Execute actions in parallel
const [result1, result2, result3] = await Promise.all([
  actions.validateRequest(requestData),
  actions.checkBudget(requestData.amount),
  actions.verifyApprover(requestData.approverId)
]);

// Process results
if (result1.valid && result2.sufficient && result3.authorized) {
  await actions.approveRequest(requestData);
} else {
  await actions.rejectRequest(requestData);
}
```

### Conditional Logic

Use standard TypeScript conditional logic to create branching workflows.

```typescript
// Get data from context
const requestAmount = data.get<number>('requestAmount');

// Conditional execution based on data
if (requestAmount > 10000) {
  // High-value request path
  context.setState('high_value_review');
  await actions.notifyFinanceDirector({ amount: requestAmount });
} else if (requestAmount > 1000) {
  // Medium-value request path
  context.setState('manager_review');
  await actions.notifyManager({ amount: requestAmount });
} else {
  // Low-value request path
  context.setState('auto_approved');
  await actions.autoApprove({ amount: requestAmount });
}
```

### Loops and Iterations

Process collections of items using standard TypeScript loops.

```typescript
// Get a collection from context
const items = data.get<Array<{ id: string, amount: number }>>('lineItems');

// Process each item
for (const item of items) {
  await actions.processItem(item);
  logger.info(`Processed item ${item.id}`);
}

// Or use map with Promise.all for parallel processing
await Promise.all(items.map(item => actions.processItem(item)));
```

### Timeouts and Delays

Implement timeouts using scheduled tasks.

```typescript
// Schedule a reminder task to execute after a delay
const { taskId } = await actions.scheduleTask({
  taskType: 'reminder',
  executeAt: new Date(Date.now() + 86400000), // 24 hours from now
  data: {
    requestId: data.get('requestId')
  }
});

// Store the scheduled task ID
data.set('reminderTaskId', taskId);

// In a separate workflow execution triggered by the scheduled task:
if (context.input.triggerEvent.name === `Task:${data.get('reminderTaskId')}:Execute`) {
  // Handle timeout
  logger.warn('Response timeout');
  await actions.sendReminder();
}
```

## 6. Best Practices

### Code Organization

- **Keep workflows focused**: Each workflow should handle a specific business process
- **Use descriptive names**: Name workflows, states, and variables clearly
- **Comment complex logic**: Add comments to explain non-obvious parts of your workflow
- **Structure with states**: Use states to clearly indicate the workflow's progress

### Error Handling

- **Always include try/catch blocks**: Handle errors gracefully
- **Log errors with context**: Include relevant information in error logs
- **Set error states**: Update the workflow state when errors occur
- **Consider recovery strategies**: Implement retry logic or fallback actions

### Performance Considerations

- **Use parallel execution**: Execute independent actions in parallel
- **Minimize data storage**: Store only necessary data in the workflow context
- **Batch operations**: Group related operations when possible
- **Consider workflow size**: Break very large workflows into smaller, focused ones

### Security Considerations

The workflow system includes security validations that check for potentially unsafe operations:

- Accessing `process.env`
- Using `require()` or dynamic `import()`
- Using `eval()` or `Function` constructor
- Accessing file system (`fs`)
- Using `child_process`
- Making direct HTTP requests
- Accessing browser objects (`document`, `window`, etc.)

Always follow security best practices and avoid these patterns in your workflows.

## 7. Testing Workflows

### Using the Test Button

The workflow editor includes a "Test" button that validates your workflow code:

1. Click the "Test" button in the editor
2. The system will validate your code structure and syntax
3. Any validation errors or warnings will be displayed
4. Security warnings will be shown if potentially unsafe code is detected

### Validation Checks

The testing process performs several checks:

- **Syntax validation**: Ensures the code is valid TypeScript
- **Structure validation**: Verifies the workflow uses the correct structure
- **Context usage**: Checks that the workflow properly uses the context object
- **State management**: Verifies that the workflow sets states
- **Error handling**: Checks for try/catch blocks
- **Security validation**: Identifies potentially unsafe code patterns

## 8. Workflow Versioning

### Creating New Versions

When you update an existing workflow, a new version is automatically created:

1. Open an existing workflow in the editor
2. Make your changes
3. Click "Save Workflow"
4. A new version will be created with your changes

### Managing Versions

You can manage workflow versions through the Versions dialog:

1. Click the "Versions" button in the workflow editor
2. View all versions of the workflow
3. Select a version to view or activate
4. Click "Set as Active" to make a specific version the active one

### Version Considerations

- Only one version can be active at a time
- Previous versions are preserved for reference and rollback
- Consider incrementing the version number for significant changes
- Add comments to explain the changes in each version

## 9. Common Workflow Patterns
### Approval Workflow

```typescript
/**
 * Approval workflow
 *
 * Basic workflow for handling approval requests
 *
 * @param context The workflow context provided by the runtime
 */
async function approvalWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state
  context.setState('submitted');
  
  // The workflow is triggered by a Submit event, which is passed as input
  const { triggerEvent } = context.input;
  logger.info(`Request submitted by ${triggerEvent.user_id}`);
  
  // Store request data
  data.set('requestData', triggerEvent.payload);
  data.set('requestor', triggerEvent.user_id);
  
  // Create approval task
  const { taskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: 'Approve Request',
    description: `Please review and approve the request`,
    assignTo: { roles: ['approver'] }
  });
  
  // Update state
  context.setState('pending_approval');
  
  // The task completion will trigger a new workflow execution
  // with the task result in the triggerEvent
  const approvalEvent = context.input.triggerEvent;
  
  // Process approval decision
  if (approvalEvent.payload.approved) {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_approved'
    });
    
    context.setState('approved');
  } else {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_rejected'
    });
    
    context.setState('rejected');
  }
}
```
```

### Service Request Workflow

```typescript
/**
 * Service Request Workflow
 *
 * Workflow for handling service requests
 *
 * @param context The workflow context provided by the runtime
 */
async function serviceRequestWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state
  context.setState('received');
  
  // The workflow is triggered by a ServiceRequest event, which is passed as input
  // This workflow would be attached to the SERVICE_REQUEST event type in the event catalog
  const { triggerEvent } = context.input;
  const requestData = triggerEvent.payload;
  
  // Validate request
  const validationResult = await actions.validateServiceRequest(requestData);
  
  if (!validationResult.valid) {
    logger.warn('Invalid service request', validationResult.errors);
    context.setState('invalid');
    
    await actions.notifyRequestor({
      requestorId: triggerEvent.user_id,
      message: 'Your service request could not be processed',
      errors: validationResult.errors
    });
    
    return;
  }
  
  // Assign to technician
  context.setState('assigning');
  
  const assignmentResult = await actions.assignServiceRequest({
    requestId: requestData.id,
    priority: requestData.priority,
    skills: requestData.requiredSkills
  });
  
  // Update state based on assignment
  if (assignmentResult.assigned) {
    context.setState('assigned');
    
    // The service request completion will trigger a new workflow execution
    // with the completion result in the triggerEvent
    const completionEvent = context.input.triggerEvent;
    
    // Process completion
    if (completionEvent.payload.success) {
      context.setState('completed');
      
      await actions.sendSatisfactionSurvey({
        requestId: requestData.id,
        requestorId: triggerEvent.user_id
      });
    } else {
      context.setState('failed');
      
      await actions.escalateFailedRequest({
        requestId: requestData.id,
        reason: completionEvent.payload.reason
      });
    }
  } else {
    context.setState('unassigned');
    
    await actions.escalateUnassignedRequest({
      requestId: requestData.id,
      reason: assignmentResult.reason
    });
  }
}
```

## 10. Troubleshooting

### Common Issues

#### Workflow Not Saving

- Ensure all required metadata fields are filled out
- Check for syntax errors in your TypeScript code
- Verify that the workflow name is unique

#### Workflow Not Executing

- Check that the workflow is active
- Verify that the expected trigger event is being sent
- Ensure the workflow is properly registered in the system

#### Action Execution Failures

- Verify that the action exists and is registered
- Check that the parameters match the action's requirements
- Look for error messages in the workflow logs

### Debugging Techniques

- Use `logger.debug()` to add debug information
- Check the workflow execution logs in the Logs & History section
- Use the Test button to validate your workflow code
- Review the workflow state transitions to identify where issues occur

## 11. Conclusion

TypeScript workflows provide a powerful way to automate business processes in your organization. By leveraging the full capabilities of TypeScript along with the structured workflow system, you can create robust, maintainable, and flexible automations.

Remember these key points:

- Use the workflow context to access actions, data, events, and logging
- Manage workflow state to track progress
- Handle errors properly to ensure robustness
- Follow security best practices
- Test your workflows thoroughly
- Use versioning to manage changes

For more information, refer to the following resources:

- [Workflow System Documentation](workflow-system.md)
- [Workflow Patterns](workflow-patterns.md)
- [Event Sourcing](event-sourcing.md)
- [Technical Documentation](technical-documentation.md)
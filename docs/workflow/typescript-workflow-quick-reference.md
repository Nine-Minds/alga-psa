# TypeScript Workflow Quick Reference

This quick reference guide provides concise information about creating TypeScript workflows in the Automation Hub. For detailed explanations, see the [TypeScript Workflow Creation Guide](typescript-workflow-creation.md) and [Automation Hub Workflow Guide](automation-hub-workflow-guide.md).

## Basic Workflow Structure

```typescript
async function workflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger } = context;
  
  // Initial state
  context.setState('initial');
  
  // Workflow implementation
  
  // Final state
  context.setState('completed');
}

```

## Workflow Context API

| Component | Description | Example |
|-----------|-------------|---------|
| `context.setState(state)` | Set workflow state | `context.setState('processing')` |
| `context.getCurrentState()` | Get current state | `const state = context.getCurrentState()` |
| `context.actions` | Execute registered actions | `await actions.updateRecord(params)` |
| `context.data` | Store/retrieve workflow data | `data.set('key', value)` |
| `context.events` | Emit events | `await events.emit('EventName')` |
| `context.logger` | Log information | `logger.info('Message', data)` |
| `context.input` | Access workflow input | `const { triggerEvent } = context.input` |

## Data Management

```typescript
// Store data
data.set('requestData', { id: '123', amount: 500 });

// Retrieve data with type safety
const requestData = data.get<{ id: string, amount: number }>('requestData');
```

## Event Handling

```typescript
// Access the trigger event
const triggerEvent = context.input.triggerEvent;

// Check event type
if (triggerEvent.name === 'ApproveRequest') {
  // Handle approval request
}

// Emit an event
await events.emit('StatusUpdated', { status: 'processing' });
```

## Action Execution

```typescript
// Execute a single action
const result = await actions.updateRecord({
  recordId: '123',
  status: 'approved'
});

// Execute multiple actions in parallel
const [result1, result2] = await Promise.all([
  actions.validateRequest(requestData),
  actions.checkBudget(requestData.amount)
]);
```

## Error Handling

```typescript
try {
  const result = await actions.riskyOperation();
  context.setState('success');
} catch (error) {
  logger.error('Operation failed', error);
  context.setState('error');
}
```

## Conditional Logic

```typescript
// If/else based on data
if (requestData.amount > 10000) {
  await actions.highValueProcess(requestData);
} else {
  await actions.standardProcess(requestData);
}

// Switch based on event type
switch (event.name) {
  case 'Approve':
    await actions.processApproval();
    break;
  case 'Reject':
    await actions.processRejection();
    break;
  default:
    logger.warn('Unknown event', event);
}
```

## Loops and Iterations

```typescript
// Process items sequentially
for (const item of items) {
  await actions.processItem(item);
}

// Process items in parallel
await Promise.all(items.map(item => actions.processItem(item)));
```

## Common Workflow Patterns

### Approval Workflow

```typescript
async function approvalWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, data } = context;
  
  // Initial state
  context.setState('submitted');
  
  // Get trigger event
  const { triggerEvent } = context.input;
  data.set('requestData', triggerEvent.payload);
  
  // Create approval task
  const { taskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: 'Approve Request',
    assignTo: { roles: ['approver'] }
  });
  
  // Set state to pending approval
  context.setState('pending_approval');
  
  // The task completion will trigger a new workflow execution
  // with the task result in the triggerEvent
  const approvalEvent = context.input.triggerEvent;
  
  // Process result
  if (approvalEvent.payload.approved) {
    context.setState('approved');
  } else {
    context.setState('rejected');
  }
}
```

### Multi-Level Approval

```typescript
// First level approval
context.setState('pending_team_lead_approval');
const { taskId: teamLeadTaskId } = await actions.createHumanTask({
  taskType: 'approval',
  title: 'Team Lead Approval',
  assignTo: { roles: ['team_lead'] }
});

// The team lead approval will trigger a new workflow execution
// with the task result in the triggerEvent
const teamLeadEvent = context.input.triggerEvent;
if (teamLeadEvent.name === `Task:${teamLeadTaskId}:Complete` &&
    !teamLeadEvent.payload.approved) {
  context.setState('rejected_by_team_lead');
  return;
}

// Second level approval
context.setState('pending_manager_approval');
const { taskId: managerTaskId } = await actions.createHumanTask({
  taskType: 'approval',
  title: 'Manager Approval',
  assignTo: { roles: ['manager'] }
});

// The manager approval will trigger a new workflow execution
// with the task result in the triggerEvent
const managerEvent = context.input.triggerEvent;
if (managerEvent.name === `Task:${managerTaskId}:Complete`) {
  if (managerEvent.payload.approved) {
    context.setState('approved');
  } else {
    context.setState('rejected_by_manager');
  }
}
```

### Parallel Approval

```typescript
// Create approval tasks
const { taskId: financial } = await actions.createHumanTask({
  taskType: 'approval',
  title: 'Financial Approval',
  assignTo: { roles: ['financial_approver'] }
});

const { taskId: technical } = await actions.createHumanTask({
  taskType: 'approval',
  title: 'Technical Approval',
  assignTo: { roles: ['technical_approver'] }
});

// For parallel approvals, we need to track which approvals have been received
// Store the task IDs
data.set('financialTaskId', financial);
data.set('technicalTaskId', technical);
data.set('financialApproved', null);
data.set('technicalApproved', null);

// The task completion will trigger a new workflow execution
// with the task result in the triggerEvent
const taskEvent = context.input.triggerEvent;

// Check which task was completed
if (taskEvent.name === `Task:${financial}:Complete`) {
  data.set('financialApproved', taskEvent.payload.approved);
} else if (taskEvent.name === `Task:${technical}:Complete`) {
  data.set('technicalApproved', taskEvent.payload.approved);
}

// Check if both tasks have been completed
const financialApproved = data.get('financialApproved');
const technicalApproved = data.get('technicalApproved');

// If both tasks have been completed, determine the final state
if (financialApproved !== null && technicalApproved !== null) {
  if (financialApproved && technicalApproved) {
    context.setState('approved');
  } else {
    context.setState('rejected');
  }
}
```

## Timeouts and Delays

```typescript
// For timeouts, use a scheduled task
const { taskId } = await actions.scheduleTask({
  taskType: 'reminder',
  executeAt: new Date(Date.now() + 86400000), // 24 hours from now
  data: {
    requestId: data.get('requestId')
  }
});

// Store the scheduled task ID
data.set('reminderTaskId', taskId);

// When the reminder task executes, it will trigger a new workflow
// with the task result in the triggerEvent
if (context.input.triggerEvent.name === `Task:${taskId}:Execute`) {
  // Handle timeout
  logger.warn('Response timeout');
  await actions.sendReminder();
}
```

## Security Considerations

Avoid these patterns in your workflows:

- ❌ `process.env` - Accessing environment variables
- ❌ `require()` or dynamic `import()` - Dynamic code loading
- ❌ `eval()` or `Function` constructor - Dynamic code execution
- ❌ `fs` - File system access
- ❌ `child_process` - Process spawning
- ❌ Direct HTTP requests - Use actions instead
- ❌ Browser objects (`document`, `window`, etc.)

## Best Practices Checklist

- ✅ Set initial and final states
- ✅ Include error handling (try/catch)
- ✅ Use descriptive state names
- ✅ Add logging for key steps
- ✅ Store only necessary data
- ✅ Use parallel execution where appropriate
- ✅ Follow security guidelines
- ✅ Add comments for complex logic
- ✅ Use semantic versioning
- ✅ Test before activating
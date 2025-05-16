# Workflow State Management Guidelines

## Overview

This document provides guidelines on managing state in workflows, specifically addressing when to use the workflow data manager (`context.data.get`/`context.data.set`) versus local variables within workflow functions.

## Understanding Workflow State

The workflow system uses an event sourcing pattern where the state of a workflow is derived by replaying events. The `WorkflowDataManager` provided via `context.data` is a key part of this system:

- It provides access to state that persists across workflow execution sessions
- It is included in snapshots for performance optimization
- It is automatically restored when a workflow is resumed after a pause

## When to Use Workflow Data Manager (`context.data`)

Use the workflow data manager for any data that needs to be:

1. **Persisted across workflow sessions or pauses**
   - Information needed when a workflow resumes after waiting for an event
   - Data that must survive if the application or server restarts

2. **Included in the workflow's audit trail**
   - Key business data relevant to the workflow's history
   - Information needed for understanding past decisions
   
3. **Available to event handlers**
   - Data needed by event handlers when responding to events
   - Context information for actions executed by the workflow
   
4. **Part of the workflow's final state**
   - Results or outcomes of the workflow execution
   - Data that might be queried after the workflow completes

## When to Use Local Variables

Use local variables within your workflow function for:

1. **Temporary computation results**
   - Intermediate values used only within a specific code block
   - Results of calculations that don't need to be persisted
   
2. **Loop counters and iterators**
   - Variables used for iteration control that don't represent workflow state
   
3. **Helper function parameters**
   - Arguments passed to helper functions that don't need to be part of state
   
4. **Short-lived data**
   - Information only needed during the current execution session
   - Data that's irrelevant after a specific step is complete

## Best Practices

### 1. Be Explicit About State

- Clearly separate data that's part of the persistent workflow state from temporary variables
- Consider using naming conventions to distinguish between the two (e.g., prefixes for workflow state variables)

### 2. Initialize Workflow State Early

```typescript
// Good practice: Initialize all expected state at the beginning
async function workflow(context: WorkflowContext): Promise<void> {
  const { data } = context;
  
  // Initialize workflow state
  if (!data.get('status')) {
    data.set('status', 'new');
  }
  if (!data.get('attempts')) {
    data.set('attempts', 0);
  }
  
  // Rest of the workflow...
}
```

### 3. Minimize Workflow State Size

- Store only what's necessary in workflow state to avoid performance issues
- For large data structures, consider storing references or IDs instead of the entire object
- Remove temporary data from workflow state when it's no longer needed

```typescript
// Instead of storing the entire result:
data.set('apiResponse', await actions.fetchLargeData());

// Consider storing just what you need:
const apiResponse = await actions.fetchLargeData();
data.set('resultId', apiResponse.id);
data.set('resultStatus', apiResponse.status);
```

### 4. Use Type Safety with Workflow Data

```typescript
// Define interface for your workflow state
interface ApprovalWorkflowState {
  requestId: string;
  requestorId: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  reviewers: string[];
  approvals: Array<{reviewerId: string, timestamp: string, approved: boolean}>;
}

// Use type safety when accessing data
const approvals = data.get<ApprovalWorkflowState['approvals']>('approvals');
```

### 5. Keep Function-Specific Logic in Local Variables

```typescript
async function workflow(context: WorkflowContext): Promise<void> {
  // Processing logic with local variables
  const response = await actions.fetchData();
  const processedItems = response.items.filter(item => item.isValid);
  let totalValue = 0;
  
  for (const item of processedItems) {
    totalValue += item.value;
  }
  
  // Store only the final result in workflow state
  data.set('totalValue', totalValue);
}
```

## Example: Balancing Workflow State and Local Variables

```typescript
async function approvalWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // ==== Workflow State (using data manager) ====
  // Request information (persists across the entire workflow)
  if (!data.get('requestInfo')) {
    const { triggerEvent } = context.input;
    data.set('requestInfo', {
      id: triggerEvent.payload.requestId,
      amount: triggerEvent.payload.amount,
      requestor: triggerEvent.user_id,
      submittedAt: triggerEvent.timestamp
    });
  }
  
  // Approval tracking (updated throughout the workflow)
  if (!data.get('approvals')) {
    data.set('approvals', []);
  }
  
  // ==== Local Variables (temporary for this execution) ====
  // Get current request info for local use
  const requestInfo = data.get('requestInfo');
  
  // Local processing - determine approvers based on amount
  const requiredApprovers = [];
  if (requestInfo.amount <= 1000) {
    requiredApprovers.push('team_lead');
  } else if (requestInfo.amount <= 10000) {
    requiredApprovers.push('team_lead', 'manager');
  } else {
    requiredApprovers.push('team_lead', 'manager', 'director');
  }
  
  // Store the required approvers list in workflow state
  data.set('requiredApprovers', requiredApprovers);
  
  // Use local variables for processing current approval level
  const approvals = data.get('approvals');
  const currentApprovalLevel = requiredApprovers[approvals.length];
  
  if (!currentApprovalLevel) {
    // All approvals received
    context.setState('completed');
    return;
  }
  
  // Create approval task
  const { taskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: `${currentApprovalLevel.toUpperCase()} Approval Required`,
    description: `Please review request #${requestInfo.id} for $${requestInfo.amount}`,
    assignTo: { roles: [currentApprovalLevel] }
  });
  
  // Store task ID in workflow state
  data.set('currentTaskId', taskId);
  context.setState('awaiting_approval');
  
  // In a real implementation, the workflow would pause here and resume when the task is completed
  // When resumed with a task.completed event:
  const approvalEvent = context.input.triggerEvent;
  
  // Update workflow state with the approval result
  if (approvalEvent.payload.approved) {
    const newApprovals = [...data.get('approvals')];
    newApprovals.push({
      level: currentApprovalLevel,
      approverId: approvalEvent.user_id,
      timestamp: approvalEvent.timestamp,
      comments: approvalEvent.payload.comments
    });
    data.set('approvals', newApprovals);
    
    // Continue to next approval level or completion
    if (newApprovals.length === requiredApprovers.length) {
      context.setState('approved');
    } else {
      context.setState('processing_next_level');
    }
  } else {
    data.set('rejectionReason', approvalEvent.payload.comments);
    data.set('rejectedBy', {
      level: currentApprovalLevel,
      approverId: approvalEvent.user_id
    });
    context.setState('rejected');
  }
}
```

## Conclusion

The event sourcing pattern used by the workflow system provides powerful capabilities for workflow persistence, auditing, and recovery. Using the workflow data manager effectively ensures your workflows can reliably maintain their state across events, while judicious use of local variables keeps your code clean and efficient.

By following these guidelines, you'll create workflows that are both robust and maintainable, with clear separation between persistent workflow state and temporary computation variables.
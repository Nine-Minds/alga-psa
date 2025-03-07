# Task Inbox Integration Technical Specification

## Overview

This document outlines the technical implementation for integrating a Task Inbox system with our distributed workflow engine. The integration will enable human interactions to be seamlessly incorporated into automated workflows through an event-driven architecture.

## Core Architecture Principles

1. **Event-Driven Integration** - All human tasks are driven by the event sourcing system
2. **Form-Based Interactions** - Human interactions are structured around form submissions
3. **Workflow Continuity** - Workflows continue execution after human tasks complete
4. **Metadata-Driven UI** - UI components are dynamically generated from schema definitions

## System Components

### 1. Task Inbox Data Model

The Task Inbox requires these primary data structures:

#### Task Definition
Metadata that describes a type of human task:
- Task type (identifier for the kind of task)
- Name and description
- Form schema reference (links to Form Registry)
- Default assignment rules
- SLA/Due date calculations

#### Task Instance
A specific task assigned to a user:
- Task ID (unique identifier)
- Execution ID (reference to workflow execution)
- Task definition reference
- Status (pending, claimed, completed, canceled)
- Assignment information
- Due date
- Priority
- Context data (information from the workflow)
- Response data (form submission data)

### 2. Workflow Integration Points

#### Creating Tasks from Workflows

Workflows create human tasks by executing a task creation action:

```typescript
// Within a workflow definition
async function approvalWorkflow(context) {
  // Create a human task
  const { taskId } = await context.actions.createHumanTask({
    taskType: 'approval',
    title: 'Approve Request',
    description: 'Please review and approve this request',
    priority: 'high',
    dueDate: '2 days', // Relative due date
    assignTo: {
      roles: ['manager'],
      users: [] // Optionally assign to specific users
    },
    contextData: {
      requestId: context.data.get('requestId'),
      amount: context.data.get('amount'),
      customerId: context.data.get('customerId')
    }
  });
  
  // Track the task ID for future reference
  context.data.set('approvalTaskId', taskId);
  
  // Wait for the task to be completed
  const taskComplete = await context.events.waitFor(`Task:${taskId}:Complete`);
  
  // Process the form submission data
  const { approved, comments } = taskComplete.payload;
  
  if (approved) {
    // Handle approval
    context.setState('approved');
  } else {
    // Handle rejection
    context.setState('rejected');
    context.data.set('rejectionReason', comments);
  }
}
```

#### Processing Form Submissions

When a user submits a form in the Task Inbox, it triggers this flow:

1. Validate form data against schema
2. Mark task as completed
3. Create a workflow event with form data as payload
4. Submit event to workflow engine
5. Workflow resumes execution

```typescript
// Task completion process (pseudocode)
async function completeTask(taskId, formData, userId) {
  // Start transaction
  const trx = await startTransaction();
  
  try {
    // Get task details
    const task = await getTaskById(taskId, trx);
    
    // Get form schema
    const taskDef = await getTaskDefinition(task.taskDefinitionId, trx);
    const formSchema = await getFormSchema(taskDef.formId, trx);
    
    // Validate form data
    const isValid = validateFormData(formSchema.jsonSchema, formData);
    if (!isValid) {
      throw new Error('Form data validation failed');
    }
    
    // Update task status
    await updateTaskStatus(taskId, 'completed', userId, trx);
    
    // Create workflow event
    const event = {
      execution_id: task.executionId,
      event_name: `Task:${taskId}:Complete`,
      event_type: 'task_completed',
      payload: formData,
      user_id: userId,
      tenant: task.tenant
    };
    
    // Create event in database
    await createWorkflowEvent(event, trx);
    
    // Publish to event stream
    await publishToEventStream(event, trx);
    
    // Commit transaction
    await trx.commit();
    
    return { success: true };
  } catch (error) {
    // Rollback transaction
    await trx.rollback();
    throw error;
  }
}
```

### 3. Extension to Workflow Interfaces

#### Task Action Result
Extend the existing `IWorkflowActionResult` to include task-specific properties:

```typescript
export interface ITaskActionResult extends IWorkflowActionResult {
  task_id: string;
  task_status: string;
  form_id: string;
  assignment: {
    roles?: string[];
    users?: string[];
  };
}
```

#### Task Related Events

Extend the workflow event system to recognize task-related events:

```typescript
// Example of task event types
export enum WorkflowTaskEventType {
  TASK_CREATED = 'task_created',
  TASK_CLAIMED = 'task_claimed',
  TASK_UNCLAIMED = 'task_unclaimed',
  TASK_COMPLETED = 'task_completed',
  TASK_CANCELED = 'task_canceled',
  TASK_EXPIRED = 'task_expired'
}
```

### 4. User Interface Components

#### Task Inbox Dashboard
The main interface showing tasks assigned to or available to the user:

- List of tasks with filters for status, priority, due date
- Grouping by workflow type, task type, or assignment
- Quick actions for claiming, completing, or delegating tasks
- Search and sort capabilities

#### Task Detail View
Displays comprehensive information about a task:

- Task metadata (title, description, priority, due date)
- Context information from the workflow
- Form for user input
- Task history (claim/unclaim actions, previous submissions)
- Related workflow information

#### Form Renderer
Dynamic form generation based on JSON Schema:

- Uses React JSONSchema Form (RJSF)
- Custom widgets for specialized inputs
- Validation based on schema
- Conditional display logic
- File attachment handling

### 5. Database Schema

```sql
-- Task definitions table
CREATE TABLE workflow_task_definitions (
  task_definition_id VARCHAR(255) PRIMARY KEY,
  tenant VARCHAR(255) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  form_id VARCHAR(255) NOT NULL,
  default_priority VARCHAR(50) DEFAULT 'medium',
  default_sla_days INTEGER DEFAULT 3,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant, task_type)
);

-- Task instances table
CREATE TABLE workflow_tasks (
  task_id VARCHAR(255) PRIMARY KEY,
  tenant VARCHAR(255) NOT NULL,
  execution_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  task_definition_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  due_date TIMESTAMP,
  context_data JSONB,
  assigned_roles JSONB,
  assigned_users JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  claimed_at TIMESTAMP,
  claimed_by VARCHAR(255),
  completed_at TIMESTAMP,
  completed_by VARCHAR(255),
  response_data JSONB,
  FOREIGN KEY (task_definition_id) REFERENCES workflow_task_definitions(task_definition_id)
);

-- Task history table for audit trail
CREATE TABLE workflow_task_history (
  history_id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL,
  tenant VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  user_id VARCHAR(255),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details JSONB,
  FOREIGN KEY (task_id) REFERENCES workflow_tasks(task_id)
);
```

## Implementation Strategy

### Phase 1: Core Infrastructure

1. **Database Schema Implementation**
   - Create database tables for task definitions and instances
   - Add indexes for query optimization
   - Implement database migration scripts

2. **Task Inbox Service**
   - Develop core service for task management
   - Implement task creation, claiming, and completion
   - Create event integration with workflow engine

3. **Form Integration**
   - Integrate Form Registry with Task Inbox
   - Implement form validation and submission
   - Connect form submission to event creation

### Phase 2: UI Development

1. **Task Inbox Dashboard**
   - Build list view of tasks with filtering
   - Implement task sorting and pagination
   - Create task action buttons (claim, complete)

2. **Task Detail View**
   - Create task detail display
   - Integrate dynamic form renderer
   - Implement form submission handling

3. **Notification System**
   - Add real-time updates for new tasks
   - Implement due date notifications
   - Create alert system for high priority tasks

### Phase 3: Workflow Integration

1. **Action Registry Extension**
   - Add task-related actions to workflow action registry
   - Implement task creation action
   - Add task query and update actions

2. **Event Processing**
   - Enhance event processing for task events
   - Implement event replay for task-related events
   - Create task status synchronization

3. **Workflow Runtime Updates**
   - Update workflow runtime to process task events
   - Implement waiting for task completion
   - Add task timeout handling

## Security Considerations

1. **Authorization**
   - Task visibility based on user roles and permissions
   - Task claiming restrictions based on assignment rules
   - Form field visibility control based on user role

2. **Audit Trail**
   - Comprehensive logging of all task interactions
   - Record of form submissions and task status changes
   - Timestamps and user information for all actions

3. **Data Protection**
   - Encryption of sensitive form data
   - Tenant isolation for multi-tenant deployments
   - Proper validation to prevent injection attacks

## Performance Optimization

1. **Indexing Strategy**
   - Optimized indexes for task queries
   - Efficient filtering by status, priority, and assignment

2. **Caching Layer**
   - Cache task definitions and form schemas
   - Implement result caching for frequent queries

3. **Batch Processing**
   - Batch notifications for task updates
   - Optimized query patterns for task listing

## Monitoring and Observability

1. **Metrics Collection**
   - Task completion time tracking
   - SLA compliance monitoring
   - User efficiency metrics

2. **Logging**
   - Structured logging for task operations
   - Error tracking for form validation issues
   - Performance logging for slow operations

3. **Alerting**
   - Alerts for tasks approaching SLA deadlines
   - Notification for stalled workflows
   - System health monitoring

## Future Enhancements

1. **Task Delegation and Reassignment**
   - Allow users to delegate tasks to others
   - Implement task reassignment workflows
   - Add delegation history tracking

2. **Advanced Form Features**
   - Multi-step forms with wizard interface
   - Conditional section visibility
   - Dynamic field generation based on context

3. **Collaborative Features**
   - Comments and discussions on tasks
   - Shared editing of responses
   - Activity feed for task interactions

4. **Mobile Support**
   - Responsive design for mobile devices
   - Push notifications for task assignments
   - Simplified mobile form interfaces
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
Metadata that describes a type of human task. Task definitions can be system-wide or tenant-specific:

-   **System Task Definitions (`system_workflow_task_definitions` table):**
    -   `task_type` (TEXT, Primary Key): Identifier for the kind of system task (e.g., 'qbo_mapping_error').
    -   Name and description.
    -   `form_id` (TEXT): Name of the form definition (usually a system form).
    -   `form_type` (TEXT): Indicates if the form is 'system' or 'tenant'. For system task definitions, this is typically 'system'.
    -   Default assignment rules, priority, SLA/due date calculations.
    -   No `tenant` column, as these are global.

-   **Tenant-Specific Task Definitions (`workflow_task_definitions` table):**
    -   `task_definition_id` (UUID, Primary Key): Unique identifier for this tenant's custom task definition.
    -   `tenant` (UUID): Tenant identifier.
    -   `task_type` (TEXT): A type identifier, which could overlap with system task types if a tenant overrides a system behavior (though linkage is distinct).
    -   Name and description.
    -   `form_id` (TEXT): Name of the form definition (can be a system form or a tenant-specific form).
    -   `form_type` (TEXT): Indicates if the form is 'system' or 'tenant'.
    -   Default assignment rules, priority, SLA/due date calculations.

#### Task Instance (`workflow_tasks` table)
A specific task assigned to a user:
- Task ID (unique identifier)
- Execution ID (reference to workflow execution)
- **Task Definition Linkage:**
    -   `task_definition_type` (TEXT): Stores 'system' or 'tenant', indicating which type of definition this task instance uses.
    -   `tenant_task_definition_id` (UUID, NULLABLE): Foreign key to `workflow_task_definitions.task_definition_id`. Populated if `task_definition_type` is 'tenant'.
    -   `system_task_definition_task_type` (TEXT, NULLABLE): Foreign key to `system_workflow_task_definitions.task_type`. Populated if `task_definition_type` is 'system'.
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
    const task = await getTaskById(taskId, trx); // task will have tenant_task_definition_id, system_task_definition_task_type, and task_definition_type
    
    // Get form schema
    let taskDef;
    if (task.task_definition_type === 'tenant') {
      taskDef = await getTenantTaskDefinition(task.tenant_task_definition_id, trx);
    } else if (task.task_definition_type === 'system') {
      taskDef = await getSystemTaskDefinition(task.system_task_definition_task_type, trx);
    }
    
    if (!taskDef) {
      throw new Error('Task definition not found for the task.');
    }
    
    // The taskDef object (from either system or tenant table) contains form_id and form_type
    const formSchema = await getFormSchema(taskDef.form_id, taskDef.form_type, task.tenant, trx); // getFormSchema might need tenant for tenant-specific forms
    
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
- **Integration with User Activities Screen**: The Task Inbox will be embedded within the new "user activities" screen, providing a centralized location for users to view and interact with their workflow tasks
- **Dual Mode Support**: The component will support both standalone mode (full-featured) and embedded mode (compact view for the activities dashboard)

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

##### Dynamic Content and Templating in Forms

To support dynamic information within forms (e.g., pre-filling fields with context-specific default values or displaying dynamic instructional text), the system utilizes a templating mechanism. This is particularly relevant for how `defaultValues` in form schemas or `default` properties of individual schema fields are processed.

The templating engine has been enhanced to use Parsimmon for parsing and safely evaluating a limited set of JavaScript-like expressions within `${...}` syntax. This allows for more sophisticated dynamic content, such as:
*   Accessing `contextData` variables (e.g., `${contextData.userName}`).
*   Using logical OR for fallbacks (e.g., `${contextData.optionalValue || 'Default Text'}`).
*   Formatting dates (e.g., `${new Date(contextData.eventTime).toLocaleString()}`).

This capability is leveraged by the Form Renderer when preparing forms for display, using the `contextData` associated with the task instance. The implementation ensures that only whitelisted expressions and operations are permitted, maintaining security even with user-influenced template expressions.

For a detailed technical design of this Parsimmon-based templating engine, refer to "[`docs/technical/parsimmon_templating_engine.md`](../technical/parsimmon_templating_engine.md)".
### 5. Database Schema

```sql
-- System Task Definitions table
CREATE TABLE system_workflow_task_definitions (
  task_type TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  form_id TEXT NOT NULL, -- Refers to system_workflow_form_definitions.name
  form_type TEXT NOT NULL DEFAULT 'system', -- Indicates the form is a system form
  default_priority TEXT DEFAULT 'medium',
  default_sla_days INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  -- No tenant column
  -- FOREIGN KEY (form_id) REFERENCES system_workflow_form_definitions(name) -- If desired, though form_id is a name string
);

-- Tenant-Specific Task Definitions table
CREATE TABLE workflow_task_definitions (
  task_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Changed to UUID
  tenant UUID NOT NULL, -- Changed to UUID
  task_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  form_id TEXT NOT NULL, -- Can refer to system_workflow_form_definitions.name or workflow_form_definitions.name
  form_type TEXT NOT NULL, -- 'system' or 'tenant'
  default_priority TEXT DEFAULT 'medium',
  default_sla_days INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant, task_type)
  -- FOREIGN KEY (form_id) ... depends on how you resolve form_id/form_type logic for FKs
);

-- Task Instances table
CREATE TABLE workflow_tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Changed to UUID
  tenant UUID NOT NULL, -- Changed to UUID
  execution_id UUID NOT NULL, -- Assuming this is also UUID
  -- event_id VARCHAR(255) NOT NULL, -- Consider if this is still needed or how it relates
  
  task_definition_type TEXT NOT NULL, -- 'system' or 'tenant'
  tenant_task_definition_id UUID NULL,
  system_task_definition_task_type TEXT NULL,

  title TEXT NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  due_date TIMESTAMPTZ,
  context_data JSONB,
  assigned_roles JSONB,
  assigned_users JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID, -- Assuming user IDs are UUIDs
  claimed_at TIMESTAMPTZ,
  claimed_by UUID,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  response_data JSONB,

  FOREIGN KEY (tenant_task_definition_id) REFERENCES workflow_task_definitions(task_definition_id),
  FOREIGN KEY (system_task_definition_task_type) REFERENCES system_workflow_task_definitions(task_type),
  CONSTRAINT chk_task_def_type CHECK
    ((task_definition_type = 'tenant' AND tenant_task_definition_id IS NOT NULL AND system_task_definition_task_type IS NULL) OR
     (task_definition_type = 'system' AND system_task_definition_task_type IS NOT NULL AND tenant_task_definition_id IS NULL))
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

### Handling Tasks with Inline Forms

While the primary mechanism described above involves tasks linked to pre-registered form definitions via `taskType`, the system also supports tasks created with "inline forms." Inline forms are defined directly within the workflow code at the point of task creation (e.g., using actions like `create_task_with_inline_form` or `createInlineTaskAndWaitForResult`).

Here's how these are integrated into the Task Inbox:

1.  **Dynamic Definition Creation**: When a task is initiated with an inline form:
    *   The system dynamically creates a temporary, tenant-specific form definition in the `workflow_form_definitions` table. This definition is flagged (e.g., `is_temporary: true`).
    *   The JSON and UI schemas provided inline are stored in `workflow_form_schemas`, linked to this temporary form definition.
    *   A corresponding temporary, tenant-specific task definition is created in `workflow_task_definitions`. This task definition links to the temporary form ID and specifies `form_type: 'tenant'`.

2.  **Task Instance Linking**: The actual task instance created in `workflow_tasks` is then linked to this temporary tenant-specific task definition using:
    *   `task_definition_type: 'tenant'`
    *   `tenant_task_definition_id`: The ID of the dynamically created temporary task definition.

3.  **Schema Retrieval by Task Inbox**: Because the task instance points to a standard (though temporary) tenant-specific task definition, the Task Inbox can retrieve its form schema using the same logic as for pre-registered forms:
    *   The inbox identifies the `task_definition_type` as 'tenant'.
    *   It uses `tenant_task_definition_id` to fetch the temporary task definition.
    *   This definition provides the `form_id` (of the temporary form) and `form_type` ('tenant').
    *   The Form Registry service (or similar logic) then retrieves the schemas from `workflow_form_definitions` and `workflow_form_schemas`.

4.  **Lifecycle and Cleanup**: These temporary definitions are typically cleaned up by a background job, as detailed in the inline forms documentation (see `docs/workflow/inline-form-example.md`).

This approach allows workflows to flexibly define ad-hoc forms while ensuring the Task Inbox can consistently render and manage them without requiring separate logic for inline versus pre-registered forms at the retrieval stage.

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
   - Develop both standalone and embedded modes for the component
   - Create responsive design that adapts to the user activities screen context

2. **User Activities Screen Integration**
   - Implement embedded version of Task Inbox for the user activities screen
   - Create compact view for the activities dashboard
   - Ensure consistent styling and interaction patterns with other activity types
   - Implement drawer-based navigation for task details within the activities context

3. **Task Detail View**
   - Create task detail display
   - Integrate dynamic form renderer
   - Implement form submission handling
   - Support viewing task details both standalone and within the activities drawer system

4. **Notification System**
   - Add real-time updates for new tasks
   - Implement due date notifications
   - Create alert system for high priority tasks
   - Ensure notifications work in both standalone and embedded contexts
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

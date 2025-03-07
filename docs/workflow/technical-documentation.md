# Technical Documentation: Dynamic Workflow UI System

## Overview

The Dynamic Workflow UI System is a flexible, metadata-driven UI solution for workflow management that dynamically adapts to different workflow scenarios without requiring continuous development of new screens. The system separates workflow logic from UI presentation, providing a consistent user experience across various business processes while maintaining flexibility and configurability.

This document provides technical documentation for all components of the Dynamic Workflow UI System.

## Architecture

The Dynamic Workflow UI System consists of several key components:

1. **Form Registry**: Centralized management of form definitions
2. **Task Inbox**: User interface for human workflow tasks
3. **Dynamic Form System**: React JSONSchema Form (RJSF) based form rendering
4. **Workflow Integration**: Event-based integration with the workflow engine

### System Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Form Registry  │◄────┤   Task Inbox    │◄────┤ Workflow Engine │
│                 │     │                 │     │                 │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │
│  Dynamic Forms  │◄────┤  Action System  │
│                 │     │                 │
└─────────────────┘     └─────────────────┘
```

## Core Components

### 1. Form Registry

The Form Registry provides centralized management for form definitions across the workflow system.

#### Key Classes and Interfaces

- `FormRegistry`: Core service for managing form definitions
- `FormDefinitionModel`: Database model for form metadata
- `FormSchemaModel`: Database model for form schemas
- `FormValidationService`: Service for validating form data against JSON Schema

#### Database Schema

The Form Registry uses two main tables:

1. **workflow_form_definitions**: Stores form metadata
   - form_id: Unique identifier for the form
   - tenant: Tenant identifier
   - name: Form name
   - description: Form description
   - version: Form version
   - status: Form status (draft, active, deprecated, archived)
   - category: Form category
   - created_by: User who created the form
   - created_at: Creation timestamp
   - updated_at: Last update timestamp

2. **workflow_form_schemas**: Stores form schemas
   - schema_id: Unique identifier for the schema
   - form_id: Reference to the form definition
   - tenant: Tenant identifier
   - json_schema: JSON Schema for form validation
   - ui_schema: UI Schema for form rendering
   - default_values: Default values for form fields
   - created_at: Creation timestamp
   - updated_at: Last update timestamp

#### Key Methods

- `register`: Register a new form definition
- `getForm`: Get a form definition by ID and version
- `updateForm`: Update a form definition
- `createNewVersion`: Create a new version of a form
- `updateStatus`: Update form status
- `deleteForm`: Delete a form definition
- `searchForms`: Search for forms
- `validateFormData`: Validate form data against a form schema
- `composeForm`: Compose a form from multiple form definitions

### 2. Task Inbox

The Task Inbox provides a user interface for human workflow tasks.

#### Key Components

- `TaskList`: Component for displaying and interacting with tasks
- `TaskDetails`: Component for displaying task details
- `TaskForm`: Component for rendering and submitting task forms
- `TaskHistory`: Component for displaying task history
- `EmbeddedTaskInbox`: Component for embedding the Task Inbox in other screens

#### Database Schema

The Task Inbox uses three main tables:

1. **workflow_task_definitions**: Stores task type definitions
   - task_definition_id: Unique identifier for the task definition
   - tenant: Tenant identifier
   - task_type: Task type identifier
   - name: Task type name
   - description: Task type description
   - form_id: Reference to the form definition
   - default_priority: Default priority for tasks of this type
   - default_sla_days: Default SLA in days

2. **workflow_tasks**: Stores task instances
   - task_id: Unique identifier for the task
   - tenant: Tenant identifier
   - execution_id: Reference to the workflow execution
   - event_id: Reference to the event that created the task
   - task_definition_id: Reference to the task definition
   - title: Task title
   - description: Task description
   - status: Task status (pending, claimed, completed, canceled)
   - priority: Task priority
   - due_date: Task due date
   - context_data: Additional data for the task
   - assigned_roles: Array of role IDs
   - assigned_users: Array of user IDs
   - created_at: Creation timestamp
   - updated_at: Last update timestamp
   - created_by: User who created the task
   - claimed_at: Timestamp when the task was claimed
   - claimed_by: User who claimed the task
   - completed_at: Timestamp when the task was completed
   - completed_by: User who completed the task
   - response_data: Form submission data

3. **workflow_task_history**: Stores task history for audit purposes
   - history_id: Unique identifier for the history entry
   - task_id: Reference to the task
   - tenant: Tenant identifier
   - action: Action performed (created, claimed, unclaimed, completed, canceled)
   - from_status: Previous task status
   - to_status: New task status
   - user_id: User who performed the action
   - timestamp: Timestamp when the action was performed
   - details: Additional details about the action

#### Key Actions

- `submitTaskForm`: Submit a task form
- `claimTask`: Claim a task
- `unclaimTask`: Unclaim a task
- `cancelTask`: Cancel a task
- `reassignTask`: Reassign a task to another user or role

### 3. Dynamic Form System

The Dynamic Form System provides a flexible way to render and interact with forms based on JSON Schema.

#### Key Components

- `DynamicForm`: Core component for rendering forms based on JSON Schema
- `ActionButton`: Component for rendering action buttons
- `ActionButtonGroup`: Component for rendering groups of action buttons
- `CustomFieldTemplate`: Custom field template for RJSF
- `customWidgets`: Custom widgets for RJSF

#### Custom Widgets

- `CompanyPickerWidget`: Widget for selecting a company
- `InputWidget`: Widget for text input
- `TextAreaWidget`: Widget for multi-line text input
- `DatePickerWidget`: Widget for date selection
- `UserPickerWidget`: Widget for selecting a user
- `CheckboxWidget`: Widget for boolean input

#### Conditional Logic

The system supports conditional display logic for form fields based on the values of other fields. This is implemented in the `conditionalLogic.ts` file.

Key functions:
- `applyConditionalLogic`: Apply conditional display logic to a schema based on form data
- `createConditionalField`: Create a conditional field that depends on another field
- `createMultiConditionalField`: Create a conditional field that depends on multiple conditions

### 4. Action System

The Action System provides a way to define and handle actions in forms.

#### Key Components

- `ActionButton`: Component for rendering an action button
- `ActionButtonGroup`: Component for rendering a group of action buttons
- `actionHandlerRegistry`: Registry for action handlers

#### Action Handler Registry

The Action Handler Registry provides a way to register and execute action handlers. Action handlers are functions that are executed when an action button is clicked.

Key methods:
- `registerHandler`: Register an action handler
- `hasHandler`: Check if a handler exists for an action
- `executeAction`: Execute an action handler

### 5. Workflow Integration

The workflow system is integrated with the Task Inbox through an event-based architecture.

#### Creating Tasks from Workflows

Workflows create human tasks by executing the `createHumanTask` action:

```typescript
// Within a workflow definition
const { taskId } = await context.actions.createHumanTask({
  taskType: 'approval',
  title: 'Approve Request',
  description: 'Please review and approve this request',
  priority: 'high',
  dueDate: '2 days',
  assignTo: {
    roles: ['manager'],
    users: []
  },
  contextData: {
    requestId: context.data.get('requestId'),
    amount: context.data.get('amount'),
    customerId: context.data.get('customerId')
  }
});

// Wait for the task to be completed
const taskComplete = await context.events.waitFor(`Task:${taskId}:Complete`);
```

#### Processing Form Submissions

When a user submits a form in the Task Inbox, it triggers this flow:

1. Validate form data against schema
2. Mark task as completed
3. Create a workflow event with form data as payload
4. Submit event to workflow engine
5. Workflow resumes execution

## Technical Implementation Details

### Form Registry Implementation

The Form Registry is implemented as a TypeScript class with methods for managing form definitions. It uses Knex.js for database operations and provides transaction support for ensuring data consistency.

### Task Inbox Implementation

The Task Inbox is implemented as a set of React components that interact with the Task Inbox service. The service provides methods for creating, claiming, and completing tasks.

### Dynamic Form Implementation

The Dynamic Form system is built on top of React JSONSchema Form (RJSF). It extends RJSF with custom widgets, field templates, and conditional logic to provide a more flexible and powerful form rendering system.

### Workflow Integration Implementation

The workflow integration is implemented through the Task Inbox service, which provides methods for creating tasks and registering task actions. The service integrates with the workflow engine through the event system.

## Performance Considerations

- **Form Rendering**: The Dynamic Form system uses React JSONSchema Form (RJSF) for form rendering. RJSF can be slow for complex forms, so performance optimizations have been implemented.
- **Task List**: The Task List component uses pagination and filtering to improve performance when displaying large numbers of tasks.
- **Conditional Logic**: The conditional logic system is optimized to minimize re-renders when form data changes.

## Security Considerations

- **Authorization**: Task visibility is based on user roles and permissions. Task claiming is restricted based on assignment rules.
- **Validation**: Form data is validated against JSON Schema before submission to prevent invalid data.
- **Audit Trail**: All task interactions are logged in the task history table for audit purposes.

## Error Handling

- **Form Validation**: Form validation errors are displayed to the user with clear messages.
- **Task Submission**: Task submission errors are handled gracefully with appropriate error messages.
- **Workflow Integration**: Errors in workflow integration are logged and handled appropriately.

## Extensibility

The Dynamic Workflow UI System is designed to be extensible:

- **Custom Widgets**: New widgets can be added to the customWidgets object.
- **Custom Field Templates**: New field templates can be created by extending the CustomFieldTemplate.
- **Action Handlers**: New action handlers can be registered with the actionHandlerRegistry.
- **Form Composition**: Forms can be composed from multiple form definitions.

## Conclusion

The Dynamic Workflow UI System provides a flexible, metadata-driven approach to workflow management. By separating workflow logic from UI presentation, it enables a consistent user experience across various business processes while maintaining flexibility and configurability.
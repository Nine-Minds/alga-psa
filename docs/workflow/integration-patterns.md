# Integration Patterns: Dynamic Workflow UI System

## Overview

The Dynamic Workflow UI System is designed to be extensible and adaptable to various business needs. This document outlines the integration patterns for extending the system with custom functionality, integrating with external systems, and building on top of the core components.

> **Important Note on Workflow Execution**: Workflows are executed in response to events. When a workflow is triggered, the event that triggered it is passed as input to the workflow. The workflow does not wait for the initial event - the fact that the workflow is executing means the event has already occurred. This is reflected in the patterns below where each workflow receives its triggering event via `context.input.triggerEvent`.

## Table of Contents

1. [Extending the Form System](#extending-the-form-system)
   - [Custom Widgets](#custom-widgets)
   - [Custom Field Templates](#custom-field-templates)
   - [Custom Validation](#custom-validation)
   - [Conditional Logic Extensions](#conditional-logic-extensions)

2. [Extending the Action System](#extending-the-action-system)
   - [Custom Action Handlers](#custom-action-handlers)
   - [Action Button Customization](#action-button-customization)
   - [Action Context Extensions](#action-context-extensions)

3. [Workflow Integration Patterns](#workflow-integration-patterns)
   - [Creating Human Tasks](#creating-human-tasks)
   - [Processing Task Responses](#processing-task-responses)
   - [Custom Event Patterns](#custom-event-patterns)
   - [Workflow State Management](#workflow-state-management)

4. [External System Integration](#external-system-integration)
   - [API Integration](#api-integration)
   - [Data Source Integration](#data-source-integration)
   - [Authentication Integration](#authentication-integration)
   - [Notification Integration](#notification-integration)

5. [Advanced Extension Patterns](#advanced-extension-patterns)
   - [Plugin Architecture](#plugin-architecture)
   - [Middleware Pattern](#middleware-pattern)
   - [Event-Driven Extensions](#event-driven-extensions)

## Extending the Form System

### Custom Widgets

The Dynamic Form system can be extended with custom widgets to support specialized input types.

#### Creating a Custom Widget

```typescript
import { WidgetProps } from '@rjsf/utils';

// Custom widget for a specialized input type
export const MyCustomWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, placeholder } = props;
  
  return (
    <div className="my-custom-widget">
      <input
        id={id}
        value={value || ''}
        disabled={disabled || readonly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        // Additional custom properties
      />
      {/* Additional custom UI elements */}
    </div>
  );
};

// Add the widget to the customWidgets object
export const customWidgets = {
  // ... existing widgets
  MyCustomWidget,
};
```

#### Registering a Custom Widget

To make your custom widget available to the form system, add it to the `customWidgets` object in `customWidgets.tsx`:

```typescript
// In customWidgets.tsx
export const customWidgets = {
  CompanyPickerWidget,
  InputWidget,
  TextAreaWidget,
  DatePickerWidget,
  UserPickerWidget,
  CheckboxWidget,
  // Add your custom widget
  MyCustomWidget,
};
```

#### Using a Custom Widget in UI Schema

```json
{
  "myField": {
    "ui:widget": "MyCustomWidget",
    "ui:options": {
      // Custom options for your widget
    }
  }
}
```

### Custom Field Templates

Field templates control the layout and structure of form fields. You can create custom field templates to customize the appearance of form fields.

#### Creating a Custom Field Template

```typescript
import { FieldTemplateProps } from '@rjsf/utils';

export function MyCustomFieldTemplate(props: FieldTemplateProps) {
  const {
    id,
    label,
    help,
    required,
    description,
    errors,
    children,
  } = props;
  
  return (
    <div className="my-custom-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="required">*</span>}
      </label>
      {description && <div className="field-description">{description}</div>}
      {children}
      {errors && <div className="field-error">{errors}</div>}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}
```

#### Using a Custom Field Template

```typescript
import { withTheme } from '@rjsf/core';
import { MyCustomFieldTemplate } from './MyCustomFieldTemplate';

const ThemedForm = withTheme({});

function MyForm() {
  return (
    <ThemedForm
      schema={schema}
      uiSchema={uiSchema}
      templates={{ FieldTemplate: MyCustomFieldTemplate }}
    />
  );
}
```

### Custom Validation

You can extend the form validation system with custom validation logic.

#### Creating a Custom Validator

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export function createCustomValidator() {
  const ajv = new Ajv({
    allErrors: true,
    multipleOfPrecision: 8,
    strict: false,
    strictTypes: false,
    strictTuples: false,
  });
  
  // Add formats
  addFormats(ajv);
  
  // Add custom formats
  ajv.addFormat('custom-email', /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
  
  // Add custom keywords
  ajv.addKeyword({
    keyword: 'customValidation',
    validate: (schema: any, data: any) => {
      // Custom validation logic
      return true; // or false if validation fails
    },
    errors: true,
  });
  
  return ajv;
}
```

#### Using a Custom Validator

```typescript
import { withTheme } from '@rjsf/core';
import { createCustomValidator } from './customValidator';

const ThemedForm = withTheme({});
const customValidator = createCustomValidator();

function MyForm() {
  return (
    <ThemedForm
      schema={schema}
      uiSchema={uiSchema}
      validator={customValidator}
    />
  );
}
```

### Conditional Logic Extensions

You can extend the conditional logic system to support more complex conditions.

#### Creating Custom Condition Types

```typescript
// In conditionalLogic.ts
function evaluateDisplayCondition(
  condition: any,
  formData: Record<string, any>
): boolean {
  // ... existing condition types
  
  // Add custom condition type
  if (condition.type === 'custom') {
    // Implement custom condition logic
    return evaluateCustomCondition(condition, formData);
  }
  
  // Default to showing the field if the condition is not recognized
  return true;
}

function evaluateCustomCondition(
  condition: any,
  formData: Record<string, any>
): boolean {
  // Implement custom condition logic
  // For example, a condition that checks if a field matches a regex pattern
  if (condition.field && condition.pattern) {
    const fieldValue = formData[condition.field];
    const regex = new RegExp(condition.pattern);
    return regex.test(fieldValue);
  }
  
  return true;
}
```

#### Using Custom Condition Types

```json
{
  "myField": {
    "ui:displayIf": {
      "type": "custom",
      "field": "otherField",
      "pattern": "^[A-Z].*$"
    }
  }
}
```

## Extending the Action System

### Custom Action Handlers

The Action System can be extended with custom action handlers to support specialized actions.

#### Creating a Custom Action Handler

```typescript
import { actionHandlerRegistry, ActionHandlerContext, ActionHandlerResult } from '../../lib/workflow/forms/actionHandlerRegistry';

// Register a custom action handler
actionHandlerRegistry.registerHandler(
  'myCustomAction',
  async (action, context: ActionHandlerContext): Promise<ActionHandlerResult> => {
    try {
      // Extract data from context
      const { formData, taskId, executionId, contextData } = context;
      
      // Implement custom action logic
      console.log('Executing custom action:', action.id);
      console.log('Form data:', formData);
      
      // For example, call an external API
      const result = await callExternalApi(formData);
      
      return {
        success: true,
        message: 'Custom action executed successfully',
        data: result
      };
    } catch (error) {
      console.error('Error executing custom action:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      };
    }
  }
);

// Helper function for the example
async function callExternalApi(data: any) {
  // Implementation of API call
  return { status: 'success', timestamp: new Date().toISOString() };
}
```

#### Using a Custom Action Handler

```typescript
// In your component
const actions = [
  {
    id: 'myCustomAction',
    label: 'Execute Custom Action',
    primary: true,
    variant: 'default',
    disabled: false,
    hidden: false,
    order: 0
  }
];

function MyComponent() {
  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      formData={formData}
      actions={actions}
    />
  );
}
```

### Action Button Customization

You can customize the appearance and behavior of action buttons.

#### Creating Custom Action Buttons

```typescript
import { Action } from '../../lib/workflow/forms/actionHandlerRegistry';
import { Button } from '../ui/Button';

interface CustomActionButtonProps {
  action: Action;
  onClick: () => void;
  isSubmitting: boolean;
}

export function CustomActionButton({ action, onClick, isSubmitting }: CustomActionButtonProps) {
  return (
    <Button
      variant={action.variant}
      disabled={action.disabled || isSubmitting}
      onClick={onClick}
      className="custom-action-button"
    >
      {action.icon && <span className={`icon ${action.icon}`} />}
      {action.label}
      {isSubmitting && action.primary && <span className="spinner" />}
    </Button>
  );
}
```

#### Using Custom Action Buttons

```typescript
import { ActionButtonGroup } from './ActionButtonGroup';
import { CustomActionButton } from './CustomActionButton';

function MyComponent() {
  return (
    <ActionButtonGroup
      actions={actions}
      onAction={handleAction}
      isSubmitting={isSubmitting}
      buttonComponent={CustomActionButton}
    />
  );
}
```

### Action Context Extensions

You can extend the action context to provide additional data to action handlers.

#### Extending the Action Handler Context

```typescript
// In actionHandlerRegistry.ts
export interface ActionHandlerContext {
  formData: any;
  taskId?: string;
  executionId?: string;
  contextData?: Record<string, any>;
  // Add custom context properties
  currentUser?: {
    id: string;
    name: string;
    roles: string[];
  };
  tenant?: string;
  customData?: Record<string, any>;
}
```

#### Providing Extended Context

```typescript
function MyComponent() {
  // Get current user information
  const currentUser = useCurrentUser();
  const tenant = useTenant();
  
  // Create extended context
  const extendedContext = {
    currentUser,
    tenant,
    customData: {
      // Additional custom data
    }
  };
  
  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      formData={formData}
      actions={actions}
      actionContext={extendedContext}
    />
  );
}
```

## Workflow Integration Patterns

### Creating Human Tasks

Workflows can create human tasks to involve users in the workflow process.

#### Basic Task Creation

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

#### Advanced Task Creation Patterns

```typescript
// Within a workflow definition
async function multiStepApprovalWorkflow(context) {
  // Step 1: Initial review
  const { taskId: initialReviewTaskId } = await context.actions.createHumanTask({
    taskType: 'initial_review',
    title: 'Initial Review',
    assignTo: { roles: ['reviewer'] }
  });
  
  // Wait for initial review
  const initialReviewComplete = await context.events.waitFor(`Task:${initialReviewTaskId}:Complete`);
  
  // Step 2: Manager approval (only if initial review is positive)
  if (initialReviewComplete.payload.recommendation === 'approve') {
    const { taskId: managerApprovalTaskId } = await context.actions.createHumanTask({
      taskType: 'manager_approval',
      title: 'Manager Approval',
      assignTo: { roles: ['manager'] },
      contextData: {
        initialReviewerId: initialReviewComplete.user_id,
        initialReviewComments: initialReviewComplete.payload.comments
      }
    });
    
    // Wait for manager approval
    const managerApprovalComplete = await context.events.waitFor(`Task:${managerApprovalTaskId}:Complete`);
    
    // Process manager decision
    if (managerApprovalComplete.payload.approved) {
      context.setState('approved');
    } else {
      context.setState('rejected_by_manager');
    }
  } else {
    // Initial review was negative
    context.setState('rejected_by_reviewer');
  }
}
```

### Processing Task Responses

Workflows can process the responses from human tasks to make decisions and continue execution.

#### Basic Response Processing

```typescript
// Within a workflow definition
async function creditApprovalWorkflow(context) {
  // Create a task
  const { taskId } = await context.actions.createHumanTask({
    taskType: 'credit_approval',
    title: 'Approve Credit Request',
    // ... other task properties
  });
  
  // Wait for task completion
  const taskComplete = await context.events.waitFor(`Task:${taskId}:Complete`);
  
  // Process the response
  const { approved, amount, reason } = taskComplete.payload;
  
  if (approved) {
    // Update credit limit
    await context.actions.updateCreditLimit({
      customerId: context.data.get('customerId'),
      newLimit: amount
    });
    
    // Send approval notification
    await context.actions.sendNotification({
      recipient: context.data.get('customerEmail'),
      template: 'credit_approval',
      data: {
        amount,
        reason
      }
    });
    
    context.setState('approved');
  } else {
    // Send rejection notification
    await context.actions.sendNotification({
      recipient: context.data.get('customerEmail'),
      template: 'credit_rejection',
      data: {
        reason
      }
    });
    
    context.setState('rejected');
  }
}
```

#### Advanced Response Processing

```typescript
// Within a workflow definition
async function complexApprovalWorkflow(context) {
  // Create a task with a complex form
  const { taskId } = await context.actions.createHumanTask({
    taskType: 'complex_approval',
    title: 'Complex Approval',
    // ... other task properties
  });
  
  // Wait for task completion
  const taskComplete = await context.events.waitFor(`Task:${taskId}:Complete`);
  
  // Extract response data
  const {
    decision,
    adjustments,
    comments,
    additionalApprovers,
    attachments
  } = taskComplete.payload;
  
  // Process decision
  switch (decision) {
    case 'approve':
      // Process approval
      await processApproval(context, adjustments);
      break;
    case 'reject':
      // Process rejection
      await processRejection(context, comments);
      break;
    case 'escalate':
      // Process escalation
      await processEscalation(context, additionalApprovers);
      break;
    case 'request_more_info':
      // Process request for more information
      await processInfoRequest(context, comments);
      break;
    default:
      throw new Error(`Unknown decision: ${decision}`);
  }
  
  // Process attachments if any
  if (attachments && attachments.length > 0) {
    await processAttachments(context, attachments);
  }
}

// Helper functions for the example
async function processApproval(context, adjustments) {
  // Implementation
}

async function processRejection(context, comments) {
  // Implementation
}

async function processEscalation(context, additionalApprovers) {
  // Implementation
}

async function processInfoRequest(context, comments) {
  // Implementation
}

async function processAttachments(context, attachments) {
  // Implementation
}
```

### Custom Event Patterns

You can define custom event patterns for workflow-task integration.

#### Custom Event Naming Conventions

```typescript
// Event naming conventions
const EVENT_PATTERNS = {
  TASK_CREATED: 'Task:{taskId}:Created',
  TASK_ASSIGNED: 'Task:{taskId}:Assigned',
  TASK_CLAIMED: 'Task:{taskId}:Claimed',
  TASK_UNCLAIMED: 'Task:{taskId}:Unclaimed',
  TASK_COMPLETED: 'Task:{taskId}:Complete',
  TASK_REJECTED: 'Task:{taskId}:Reject',
  TASK_CANCELED: 'Task:{taskId}:Cancel',
  TASK_EXPIRED: 'Task:{taskId}:Expired',
  TASK_REASSIGNED: 'Task:{taskId}:Reassigned',
  FORM_SUBMITTED: 'Form:{formId}:Submit',
  FORM_SAVED: 'Form:{formId}:Save',
  FORM_VALIDATED: 'Form:{formId}:Validate'
};

// Usage in workflow
async function workflowWithCustomEvents(context) {
  // Create a task
  const { taskId } = await context.actions.createHumanTask({
    // ... task properties
  });
  
  // Wait for multiple possible events
  const event = await context.events.waitFor([
    EVENT_PATTERNS.TASK_COMPLETED.replace('{taskId}', taskId),
    EVENT_PATTERNS.TASK_REJECTED.replace('{taskId}', taskId),
    EVENT_PATTERNS.TASK_EXPIRED.replace('{taskId}', taskId)
  ]);
  
  // Process the event based on its name
  switch (event.name) {
    case EVENT_PATTERNS.TASK_COMPLETED.replace('{taskId}', taskId):
      // Process completion
      break;
    case EVENT_PATTERNS.TASK_REJECTED.replace('{taskId}', taskId):
      // Process rejection
      break;
    case EVENT_PATTERNS.TASK_EXPIRED.replace('{taskId}', taskId):
      // Process expiration
      break;
  }
}
```

#### Custom Event Payloads

```typescript
// Custom event payload structure
interface TaskCompletionPayload {
  decision: 'approve' | 'reject' | 'escalate';
  comments: string;
  metadata: {
    completedAt: string;
    completedBy: string;
    clientInfo: {
      browser: string;
      os: string;
      ip: string;
    };
  };
  formData: Record<string, any>;
}

// Creating an event with custom payload
async function createTaskCompletionEvent(
  taskId: string,
  executionId: string,
  payload: TaskCompletionPayload,
  userId: string,
  tenant: string
) {
  return workflowRuntime.enqueueEvent({
    execution_id: executionId,
    event_name: `Task:${taskId}:Complete`,
    event_type: 'task_completed',
    payload,
    user_id: userId,
    tenant,
    metadata: {
      source: 'task_inbox',
      timestamp: new Date().toISOString()
    }
  });
}
```

### Workflow State Management

Workflows can manage state based on task interactions.

#### State Transitions Based on Task Outcomes

```typescript
// Within a workflow definition
async function stateBasedWorkflow(context) {
  // Initial state - Processing
  context.setState('processing');
  
  // The workflow is triggered by a Submit event, which is passed as input
  const { triggerEvent } = context.input;
  logger.info(`Processing submission from ${triggerEvent.user_id}`);
  context.setState('submitted');
  
  // Create review task
  const { taskId } = await context.actions.createHumanTask({
    taskType: 'review',
    title: 'Review Submission',
    // ... other task properties
  });
  
  // Wait for review completion
  const reviewComplete = await context.events.waitFor(`Task:${taskId}:Complete`);
  
  // Transition state based on review outcome
  if (reviewComplete.payload.decision === 'approve') {
    context.setState('approved');
    
    // Create processing task
    const { taskId: processingTaskId } = await context.actions.createHumanTask({
      taskType: 'processing',
      title: 'Process Approved Submission',
      // ... other task properties
    });
    
    // Wait for processing completion
    await context.events.waitFor(`Task:${processingTaskId}:Complete`);
    context.setState('processed');
  } else if (reviewComplete.payload.decision === 'reject') {
    context.setState('rejected');
  } else if (reviewComplete.payload.decision === 'revise') {
    context.setState('revision_requested');
    
    // The workflow will end here, and a new workflow will be triggered when a Resubmit event occurs
    logger.info('Waiting for document resubmission');
    
    // Note: In a real implementation, we would end this workflow here
    // and start a new workflow instance when the Resubmit event occurs
  }
}
```

#### Parallel State Management

```typescript
// Within a workflow definition
async function parallelStateWorkflow(context) {
  // Initial state
  context.setState('initiated');
  
  // Create multiple parallel tasks
  const [
    { taskId: financialReviewTaskId },
    { taskId: technicalReviewTaskId },
    { taskId: legalReviewTaskId }
  ] = await Promise.all([
    context.actions.createHumanTask({
      taskType: 'financial_review',
      title: 'Financial Review',
      // ... other task properties
    }),
    context.actions.createHumanTask({
      taskType: 'technical_review',
      title: 'Technical Review',
      // ... other task properties
    }),
    context.actions.createHumanTask({
      taskType: 'legal_review',
      title: 'Legal Review',
      // ... other task properties
    })
  ]);
  
  // Track review states
  const reviewStates = {
    financial: null,
    technical: null,
    legal: null
  };
  
  // Wait for all reviews to complete
  await Promise.all([
    (async () => {
      const financialReview = await context.events.waitFor(`Task:${financialReviewTaskId}:Complete`);
      reviewStates.financial = financialReview.payload.approved ? 'approved' : 'rejected';
      context.data.set('financialReviewComments', financialReview.payload.comments);
    })(),
    (async () => {
      const technicalReview = await context.events.waitFor(`Task:${technicalReviewTaskId}:Complete`);
      reviewStates.technical = technicalReview.payload.approved ? 'approved' : 'rejected';
      context.data.set('technicalReviewComments', technicalReview.payload.comments);
    })(),
    (async () => {
      const legalReview = await context.events.waitFor(`Task:${legalReviewTaskId}:Complete`);
      reviewStates.legal = legalReview.payload.approved ? 'approved' : 'rejected';
      context.data.set('legalReviewComments', legalReview.payload.comments);
    })()
  ]);
  
  // Determine final state based on all reviews
  const allApproved = Object.values(reviewStates).every(state => state === 'approved');
  
  if (allApproved) {
    context.setState('all_approved');
  } else {
    context.setState('rejected');
    context.data.set('rejectionReasons', Object.entries(reviewStates)
      .filter(([_, state]) => state === 'rejected')
      .map(([type]) => type)
    );
  }
}
```

## External System Integration

### API Integration

You can integrate the workflow system with external APIs.

#### Action Handler for API Integration

```typescript
// Register an action handler for API integration
actionHandlerRegistry.registerHandler(
  'callExternalApi',
  async (action, context: ActionHandlerContext): Promise<ActionHandlerResult> => {
    try {
      const { formData } = context;
      
      // Extract API configuration from action options
      const {
        url,
        method = 'POST',
        headers = {},
        bodyFields = [],
        responseMapping = {}
      } = action.options || {};
      
      if (!url) {
        throw new Error('API URL is required');
      }
      
      // Build request body from form data
      const body: Record<string, any> = {};
      
      if (bodyFields.length === 0) {
        // Use all form data if no specific fields are specified
        Object.assign(body, formData);
      } else {
        // Use only specified fields
        bodyFields.forEach(field => {
          if (field in formData) {
            body[field] = formData[field];
          }
        });
      }
      
      // Make API request
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      const responseData = await response.json();
      
      // Map response data to result
      const result: Record<string, any> = {};
      
      if (Object.keys(responseMapping).length === 0) {
        // Use all response data if no mapping is specified
        Object.assign(result, responseData);
      } else {
        // Map response fields according to mapping
        Object.entries(responseMapping).forEach(([source, target]) => {
          const value = source.split('.').reduce((obj, key) => obj?.[key], responseData);
          if (value !== undefined) {
            result[target as string] = value;
          }
        });
      }
      
      return {
        success: true,
        message: 'API request successful',
        data: result
      };
    } catch (error) {
      console.error('Error calling external API:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      };
    }
  }
);
```

#### Using the API Integration Action

```typescript
// In your component
const apiActions = [
  {
    id: 'callExternalApi',
    label: 'Submit to External System',
    primary: true,
    variant: 'default',
    options: {
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY'
      },
      bodyFields: ['name', 'email', 'message'],
      responseMapping: {
        'id': 'externalId',
        'status': 'externalStatus',
        'created_at': 'timestamp'
      }
    }
  }
];

function ApiIntegrationForm() {
  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      formData={formData}
      actions={apiActions}
    />
  );
}
```

### Data Source Integration

You can integrate the workflow system with external data sources.

#### Data Source Widget

```typescript
import { WidgetProps } from '@rjsf/utils';
import { useState, useEffect } from 'react';

// Widget for selecting data from an external data source
export const ExternalDataWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, options } = props;
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch data from external source
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { dataSource, params = {} } = options || {};
        
        if (!dataSource) {
          throw new Error('Data source URL is required');
        }
        
        // Build query parameters
        const queryParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          queryParams.append(key, String(value));
        });
        
        // Fetch data
        const response = await fetch(`${dataSource}?${queryParams.toString()}`);
        
        if (!response.ok) {
          throw new Error(`Data source request failed with status ${response.status}`);
        }
        
        const data = await response.json();
        
        // Map data to items
        const mappedItems = data.map((item: any) => ({
          id: item.id,
          name: item.name || item.title || item.label || item.id
        }));
        
        setItems(mappedItems);
      } catch (error) {
        console.error('Error fetching data:', error);
        setError(error instanceof Error ? error.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [options]);
  
  return (
    <div className="external-data-widget">
      {loading && <div className="loading">Loading...</div>}
      {error && <div className="error">{error}</div>}
      
      <select
        id={id}
        value={value || ''}
        disabled={disabled || readonly || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select an option</option>
        {items.map(item => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
};
```

#### Using the Data Source Widget

```json
{
  "product": {
    "ui:widget": "ExternalDataWidget",
    "ui:options": {
      "dataSource": "https://api.example.com/products",
      "params": {
        "category": "electronics",
        "limit": 100
      }
    }
  }
}
```

### Authentication Integration

You can integrate the workflow system with authentication systems.

#### Authentication Context Provider

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Authentication context
interface AuthContext {
  user: {
    id: string;
    name: string;
    roles: string[];
  } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContext>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null
});

// Authentication provider
interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthContext['user']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchUser = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Fetch user data from authentication system
        const response = await fetch('/api/auth/user');
        
        if (!response.ok) {
          throw new Error(`Authentication request failed with status ${response.status}`);
        }
        
        const userData = await response.json();
        
        setUser({
          id: userData.id,
          name: userData.name,
          roles: userData.roles || []
        });
      } catch (error) {
        console.error('Error fetching user data:', error);
        setError(error instanceof Error ? error.message : 'An error occurred');
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchUser();
  }, []);
  
  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        error
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Hook for using authentication context
export function useAuth() {
  return useContext(AuthContext);
}
```

#### Using Authentication in Task Inbox

```typescript
import { useAuth } from './AuthProvider';

function TaskInbox() {
  const { user, isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <div>Please log in to access the Task Inbox</div>;
  }
  
  return (
    <div>
      <h1>Task Inbox for {user?.name}</h1>
      <TaskList userId={user?.id} userRoles={user?.roles} />
    </div>
  );
}
```

### Notification Integration

You can integrate the workflow system with notification systems.

#### Notification Action Handler

```typescript
// Register a notification action handler
actionHandlerRegistry.registerHandler(
  'sendNotification',
  async (action, context: ActionHandlerContext): Promise<ActionHandlerResult> => {
    try {
      const { formData } = context;
      
      // Extract notification configuration from action options
      const {
        type = 'email',
        recipient,
        template,
        subject,
        data = {}
      } = action.options || {};
      
      if (!recipient) {
        throw new Error('Notification recipient is required');
      }
      
      // Combine form data with additional data
      const notificationData = {
        ...formData,
        ...data
      };
      
      // Send notification based on type
      switch (type) {
        case 'email':
          await sendEmailNotification(recipient, template, subject, notificationData);
          break;
        case 'sms':
          await sendSmsNotification(recipient, template, notificationData);
          break;
        case 'push':
          await sendPushNotification(recipient, template, notificationData);
          break;
        default:
          throw new Error(`Unsupported notification type: ${type}`);
      }
      
      return {
        success: true,
        message: `${type} notification sent successfully`
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      };
    }
  }
);

// Helper functions for the example
async function sendEmailNotification(recipient: string, template: string, subject: string, data: any) {
  // Implementation of email notification
}

async function sendSmsNotification(recipient: string, template: string, data: any) {
  // Implementation of SMS notification
}

async function sendPushNotification(recipient: string, template: string, data: any) {
  // Implementation of push notification
}
```

#### Using the Notification Action

```typescript
// In your component
const notificationActions = [
  {
    id: 'sendNotification',
    label: 'Submit and Notify',
    primary: true,
    variant: 'default',
    options: {
      type: 'email',
      recipient: 'user@example.com',
      template: 'form_submission',
      subject: 'Form Submission Notification',
      data: {
        applicationId: '12345',
        timestamp: new Date().toISOString()
      }
    }
  }
];

function NotificationForm() {
  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      formData={formData}
      actions={notificationActions}
    />
  );
}
```

## Advanced Extension Patterns

### Plugin Architecture

You can implement a plugin architecture to allow for modular extensions of the workflow system.

#### Plugin Registry

```typescript
// Plugin interface
interface Plugin {
  id: string;
  name: string;
  version: string;
  initialize: (context: PluginContext) => Promise<void>;
}

// Plugin context
interface PluginContext {
  registerWidget: (name: string, widget: any) => void;
  registerFieldTemplate: (name: string, template: any) => void;
  registerActionHandler: (id: string, handler: any) => void;
  registerValidator: (name: string, validator: any) => void;
  // Add other extension points
}

// Plugin registry
class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private widgets: Map<string, any> = new Map();
  private fieldTemplates: Map<string, any> = new Map();
  private actionHandlers: Map<string, any> = new Map();
  private validators: Map<string, any> = new Map();
  
  // Register a plugin
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin with ID ${plugin.id} is already registered`);
    }
    
    // Create plugin context
    const context: PluginContext = {
      registerWidget: (name, widget) => this.widgets.set(name, widget),
      registerFieldTemplate: (name, template) => this.fieldTemplates.set(name, template),
      registerActionHandler: (id, handler) => this.actionHandlers.set(id, handler),
      registerValidator: (name, validator) => this.validators.set(name, validator)
    };
    
    // Initialize plugin
    await plugin.initialize(context);
    
    // Store plugin
    this.plugins.set(plugin.id, plugin);
    
    console.log(`Plugin ${plugin.name} (${plugin.version}) registered successfully`);
  }
  
  // Get a widget
  getWidget(name: string): any {
    return this.widgets.get(name);
  }
  
  // Get a field template
  getFieldTemplate(name: string): any {
    return this.fieldTemplates.get(name);
  }
  
  // Get an action handler
  getActionHandler(id: string): any {
    return this.actionHandlers.get(id);
  }
  
  // Get a validator
  getValidator(name: string): any {
    return this.validators.get(name);
  }
  
  // Get all widgets
  getAllWidgets(): Record<string, any> {
    return Object.fromEntries(this.widgets.entries());
  }
  
  // Get all field templates
  getAllFieldTemplates(): Record<string, any> {
    return Object.fromEntries(this.fieldTemplates.entries());
  }
  
  // Get all action handlers
  getAllActionHandlers(): Record<string, any> {
    return Object.fromEntries(this.actionHandlers.entries());
  }
  
  // Get all validators
  getAllValidators(): Record<string, any> {
    return Object.fromEntries(this.validators.entries());
  }
}

// Singleton instance
let registryInstance: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  if (!registryInstance) {
    registryInstance = new PluginRegistry();
  }
  return registryInstance;
}
```

#### Creating a Plugin

```typescript
import { Plugin, PluginContext } from './pluginRegistry';

// Example plugin
const myPlugin: Plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  
  async initialize(context: PluginContext): Promise<void> {
    // Register a custom widget
    context.registerWidget('MyCustomWidget', MyCustomWidget);
    
    // Register a custom field template
    context.registerFieldTemplate('MyCustomFieldTemplate', MyCustomFieldTemplate);
    
    // Register a custom action handler
    context.registerActionHandler('myCustomAction', myCustomActionHandler);
    
    // Register a custom validator
    context.registerValidator('myCustomValidator', myCustomValidator);
  }
};

// Register the plugin
import { getPluginRegistry } from './pluginRegistry';

async function registerPlugins() {
  const registry = getPluginRegistry();
  await registry.registerPlugin(myPlugin);
}

registerPlugins().catch(console.error);
```

### Middleware Pattern

You can implement a middleware pattern to intercept and modify form submissions and actions.

#### Action Middleware

```typescript
// Middleware interface
interface ActionMiddleware {
  id: string;
  priority: number;
  before?: (action: any, context: any) => Promise<{ action: any; context: any } | null>;
  after?: (result: any, action: any, context: any) => Promise<any>;
  error?: (error: any, action: any, context: any) => Promise<any>;
}

// Middleware registry
class MiddlewareRegistry {
  private middlewares: ActionMiddleware[] = [];
  
  // Register middleware
  registerMiddleware(middleware: ActionMiddleware): void {
    this.middlewares.push(middleware);
    // Sort by priority (higher priority executes first)
    this.middlewares.sort((a, b) => b.priority - a.priority);
  }
  
  // Apply middleware before action execution
  async applyBeforeMiddlewares(action: any, context: any): Promise<{ action: any; context: any } | null> {
    let currentAction = action;
    let currentContext = context;
    
    for (const middleware of this.middlewares) {
      if (middleware.before) {
        const result = await middleware.before(currentAction, currentContext);
        
        if (result === null) {
          // Middleware canceled the action
          return null;
        }
        
        currentAction = result.action;
        currentContext = result.context;
      }
    }
    
    return { action: currentAction, context: currentContext };
  }
  
  // Apply middleware after action execution
  async applyAfterMiddlewares(result: any, action: any, context: any): Promise<any> {
    let currentResult = result;
    
    for (const middleware of this.middlewares) {
      if (middleware.after) {
        currentResult = await middleware.after(currentResult, action, context);
      }
    }
    
    return currentResult;
  }
  
  // Apply middleware on error
  async applyErrorMiddlewares(error: any, action: any, context: any): Promise<any> {
    let currentError = error;
    
    for (const middleware of this.middlewares) {
      if (middleware.error) {
        try {
          // Middleware can handle the error and return a result
          return await middleware.error(currentError, action, context);
        } catch (newError) {
          // Middleware rethrew or threw a new error
          currentError = newError;
        }
      }
    }
    
    // If no middleware handled the error, rethrow it
    throw currentError;
  }
}

// Singleton instance
let middlewareRegistryInstance: MiddlewareRegistry | null = null;

export function getMiddlewareRegistry(): MiddlewareRegistry {
  if (!middlewareRegistryInstance) {
    middlewareRegistryInstance = new MiddlewareRegistry();
  }
  return middlewareRegistryInstance;
}
```

#### Using Middleware

```typescript
import { getMiddlewareRegistry } from './middlewareRegistry';

// Register logging middleware
getMiddlewareRegistry().registerMiddleware({
  id: 'logging',
  priority: 100, // High priority, executes first
  
  async before(action, context) {
    console.log(`[Logging] Before action ${action.id}`, { action, context });
    return { action, context };
  },
  
  async after(result, action, context) {
    console.log(`[Logging] After action ${action.id}`, { result, action, context });
    return result;
  },
  
  async error(error, action, context) {
    console.error(`[Logging] Error in action ${action.id}`, { error, action, context });
    throw error; // Rethrow the error
  }
});

// Register validation middleware
getMiddlewareRegistry().registerMiddleware({
  id: 'validation',
  priority: 90, // Executes after logging
  
  async before(action, context) {
    // Validate action parameters
    if (action.id === 'submitForm' && !context.formData) {
      console.warn('[Validation] Missing form data');
      return null; // Cancel the action
    }
    
    return { action, context };
  }
});

// Register authentication middleware
getMiddlewareRegistry().registerMiddleware({
  id: 'authentication',
  priority: 80, // Executes after validation
  
  async before(action, context) {
    // Check if user is authenticated
    if (!context.currentUser) {
      throw new Error('User is not authenticated');
    }
    
    return { action, context };
  }
});

// Modify action executor to use middleware
async function executeAction(action, context) {
  const middlewareRegistry = getMiddlewareRegistry();
  
  try {
    // Apply before middlewares
    const beforeResult = await middlewareRegistry.applyBeforeMiddlewares(action, context);
    
    if (beforeResult === null) {
      // Action was canceled by middleware
      return { success: false, message: 'Action canceled by middleware' };
    }
    
    // Execute the action with modified action and context
    const result = await originalExecuteAction(beforeResult.action, beforeResult.context);
    
    // Apply after middlewares
    return await middlewareRegistry.applyAfterMiddlewares(result, action, context);
  } catch (error) {
    // Apply error middlewares
    return await middlewareRegistry.applyErrorMiddlewares(error, action, context);
  }
}
```

### Event-Driven Extensions

You can implement event-driven extensions to allow components to communicate and react to events.

#### Event Bus

```typescript
// Event interface
interface Event {
  type: string;
  payload: any;
  source?: string;
  timestamp?: string;
}

// Event handler type
type EventHandler = (event: Event) => void;

// Event bus
class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  
  // Subscribe to an event
  subscribe(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    
    this.handlers.get(eventType)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      const handlersForType = this.handlers.get(eventType);
      if (handlersForType) {
        handlersForType.delete(handler);
        if (handlersForType.size === 0) {
          this.handlers.delete(eventType);
        }
      }
    };
  }
  
  // Publish an event
  publish(event: Event): void {
    // Add timestamp if not provided
    const eventWithTimestamp = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    };
    
    // Get handlers for this event type
    const handlersForType = this.handlers.get(event.type);
    
    if (handlersForType) {
      // Execute all handlers
      handlersForType.forEach(handler => {
        try {
          handler(eventWithTimestamp);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      });
    }
    
    // Also execute handlers for wildcard events
    const wildcardHandlers = this.handlers.get('*');
    
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => {
        try {
          handler(eventWithTimestamp);
        } catch (error) {
          console.error(`Error in wildcard event handler for ${event.type}:`, error);
        }
      });
    }
  }
}

// Singleton instance
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}
```

#### Using the Event Bus

```typescript
import { getEventBus } from './eventBus';

// Subscribe to form submission events
const unsubscribe = getEventBus().subscribe('form:submit', event => {
  console.log('Form submitted:', event.payload);
  
  // Perform additional actions
  if (event.payload.formId === 'credit-reimbursement-request') {
    // Send analytics event
    sendAnalyticsEvent('credit_reimbursement_submitted', {
      amount: event.payload.formData.amount,
      customer: event.payload.formData.customer
    });
  }
});

// Publish a form submission event
function handleFormSubmit(formId, formData) {
  // Process form submission
  
  // Publish event
  getEventBus().publish({
    type: 'form:submit',
    payload: {
      formId,
      formData
    },
    source: 'form-component'
  });
}

// Clean up subscription when component unmounts
function componentWillUnmount() {
  unsubscribe();
}
```

## Conclusion

The Dynamic Workflow UI System provides a flexible foundation for building workflow applications. By leveraging these integration patterns, you can extend the system to meet your specific business needs, integrate with external systems, and build custom functionality on top of the core components.

Remember to follow these best practices when extending the system:

1. **Maintain Separation of Concerns**: Keep UI components, business logic, and data access separate
2. **Use TypeScript**: Leverage TypeScript's type system to ensure type safety and improve developer experience
3. **Write Tests**: Test your extensions thoroughly to ensure they work correctly
4. **Document Your Extensions**: Document your extensions so others can understand and use them
5. **Follow Performance Best Practices**: Optimize your extensions for performance, especially for complex forms and large data sets
6. **Consider Security**: Ensure your extensions follow security best practices, especially when integrating with external systems
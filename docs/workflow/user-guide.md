# User Guide: Dynamic Workflow UI System

## Introduction

The Dynamic Workflow UI System provides a flexible, metadata-driven approach to workflow management. This user guide explains how to create and manage forms, and how to work with tasks in the Task Inbox.

## Table of Contents

1. [Form Creation and Management](#form-creation-and-management)
   - [Creating a New Form](#creating-a-new-form)
   - [Form Schema Structure](#form-schema-structure)
   - [UI Schema Customization](#ui-schema-customization)
   - [Form Versioning](#form-versioning)
   - [Form Composition](#form-composition)
   - [Form Validation](#form-validation)

2. [Task Management](#task-management)
   - [Task Inbox Overview](#task-inbox-overview)
   - [Viewing and Filtering Tasks](#viewing-and-filtering-tasks)
   - [Claiming and Unclaiming Tasks](#claiming-and-unclaiming-tasks)
   - [Completing Tasks](#completing-tasks)
   - [Task History](#task-history)

## Form Creation and Management

### Creating a New Form

Forms are the building blocks of the workflow system. They define the structure and validation rules for data collection during workflow execution.

#### Using the Form Registry API

```typescript
import { registerFormAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Register a new form
const formId = await registerFormAction({
  formId: 'credit-reimbursement-request',
  name: 'Credit Reimbursement Request',
  description: 'Form for requesting credit reimbursements',
  version: '1.0.0',
  category: 'finance',
  status: FormStatus.ACTIVE,
  jsonSchema: {
    type: 'object',
    required: ['customer', 'amount', 'reason'],
    properties: {
      customer: {
        type: 'string',
        title: 'Customer Name'
      },
      amount: {
        type: 'number',
        title: 'Amount'
      },
      reason: {
        type: 'string',
        title: 'Reason for Reimbursement'
      },
      date: {
        type: 'string',
        format: 'date',
        title: 'Date of Transaction'
      }
    }
  },
  uiSchema: {
    customer: {
      'ui:autofocus': true
    },
    amount: {
      'ui:widget': 'currencyWidget'
    },
    reason: {
      'ui:widget': 'textarea'
    },
    date: {
      'ui:widget': 'date'
    }
  }
}, ['reimbursement', 'credit', 'finance']);
```

### Form Schema Structure

The form schema defines the structure and validation rules for the form data. It follows the JSON Schema standard.

#### Basic Schema Structure

```json
{
  "type": "object",
  "required": ["field1", "field2"],
  "properties": {
    "field1": {
      "type": "string",
      "title": "Field 1",
      "description": "Description of Field 1"
    },
    "field2": {
      "type": "number",
      "title": "Field 2",
      "minimum": 0,
      "maximum": 100
    }
  }
}
```

#### Common Field Types

- **String**: `"type": "string"`
- **Number**: `"type": "number"`
- **Boolean**: `"type": "boolean"`
- **Object**: `"type": "object"` (for nested objects)
- **Array**: `"type": "array"` (for lists)

#### Validation Rules

- **Required Fields**: Use the `required` property at the object level
- **String Validation**: `minLength`, `maxLength`, `pattern`
- **Number Validation**: `minimum`, `maximum`, `multipleOf`
- **Array Validation**: `minItems`, `maxItems`, `uniqueItems`

### UI Schema Customization

The UI schema customizes the appearance and behavior of the form fields.

#### Basic UI Schema Structure

```json
{
  "field1": {
    "ui:widget": "textarea",
    "ui:placeholder": "Enter text here",
    "ui:autofocus": true
  },
  "field2": {
    "ui:widget": "updown",
    "ui:title": "Custom Title",
    "ui:description": "Custom description"
  }
}
```

#### Available Widgets

- **Text Input**: `"ui:widget": "text"` (default for strings)
- **Textarea**: `"ui:widget": "textarea"` (for multi-line text)
- **Select**: `"ui:widget": "select"` (for enumerated values)
- **Checkbox**: `"ui:widget": "checkbox"` (for booleans)
- **Date**: `"ui:widget": "date"` (for dates)
- **Currency**: `"ui:widget": "currencyWidget"` (for monetary values)
- **Company Picker**: `"ui:widget": "CompanyPickerWidget"` (for selecting companies)
- **User Picker**: `"ui:widget": "UserPickerWidget"` (for selecting users)

#### Conditional Display

You can use the `ui:displayIf` property to conditionally display fields based on the values of other fields.

```json
{
  "paymentType": {
    "ui:widget": "select"
  },
  "creditCardNumber": {
    "ui:widget": "text",
    "ui:displayIf": {
      "field": "paymentType",
      "value": "creditCard"
    }
  }
}
```

### Form Versioning

Forms can have multiple versions to support evolving requirements while maintaining backward compatibility.

#### Creating a New Version

```typescript
import { createNewVersionAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Create a new version of a form
await createNewVersionAction('credit-reimbursement-request', '2.0.0', {
  description: 'Version 2.0 of the credit reimbursement request form',
  jsonSchema: {
    // Updated JSON Schema for version 2.0
  }
});
```

#### Version Lifecycle

1. **Draft**: Initial state for new versions
2. **Active**: Version is ready for use
3. **Deprecated**: Version is still usable but will be phased out
4. **Archived**: Version is no longer usable

### Form Composition

Forms can be composed from multiple form definitions to promote reuse and modularity.

#### Composing Forms

```typescript
import { composeFormAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Compose a form from multiple form definitions
const composedFormId = await composeFormAction(
  'base-reimbursement-form',
  ['credit-extension-form', 'approval-extension-form'],
  {
    name: 'Composed Credit Reimbursement Form',
    description: 'A form composed from multiple form definitions',
    category: 'finance',
    jsonSchema: {
      // Additional JSON Schema properties
    },
    uiSchema: {
      // Additional UI Schema properties
    }
  },
  ['composed', 'reimbursement', 'credit']
);
```

### Form Validation

Forms are validated against their JSON Schema before submission to ensure data integrity.

#### Validating Form Data

```typescript
import { validateFormDataAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Validate form data against a form schema
const validationResult = await validateFormDataAction('credit-reimbursement-request', {
  customer: 'Acme Inc.',
  amount: 100.50,
  reason: 'Overpayment',
  date: '2025-03-07'
});

if (validationResult.valid) {
  // Form data is valid
} else {
  // Form data is invalid
  console.error('Validation errors:', validationResult.errors);
}
```

## Task Management

### Task Inbox Overview

The Task Inbox provides a centralized location for users to view and interact with their workflow tasks.

#### Task Inbox Components

- **Task List**: Displays a list of tasks assigned to or available to the user
- **Task Details**: Shows detailed information about a selected task
- **Task Form**: Displays the form for completing a task
- **Task History**: Shows the history of a task

### Viewing and Filtering Tasks

The Task List component allows users to view and filter their tasks.

#### Available Filters

- **Status**: Filter by task status (pending, claimed, completed, canceled)
- **Priority**: Filter by task priority (low, medium, high, critical)
- **Due Date**: Filter by due date (overdue, due today, due this week, etc.)
- **Assignment**: Filter by assignment (assigned to me, available to claim, etc.)

#### Sorting Options

- **Due Date**: Sort by due date (ascending or descending)
- **Priority**: Sort by priority (ascending or descending)
- **Created Date**: Sort by created date (ascending or descending)

### Claiming and Unclaiming Tasks

Tasks can be claimed by users to indicate that they are working on them.

#### Claiming a Task

1. Find the task in the Task List
2. Click the "Claim" button
3. The task will be assigned to you and moved to your claimed tasks

#### Unclaiming a Task

1. Find the task in your claimed tasks
2. Click the "Unclaim" button
3. The task will be unassigned and available for others to claim

### Completing Tasks

Tasks are completed by submitting the associated form.

#### Completing a Task

1. Open the task in the Task Details view
2. Fill out the form with the required information
3. Click the "Complete" button
4. The form data will be validated and submitted
5. If validation passes, the task will be marked as completed
6. The workflow will continue execution based on the form data

### Task History

The Task History component shows the history of a task, including status changes and user interactions.

#### History Information

- **Action**: The action performed (created, claimed, unclaimed, completed, canceled)
- **User**: The user who performed the action
- **Timestamp**: When the action was performed
- **Details**: Additional details about the action

## Best Practices

### Form Design

- **Keep forms simple**: Focus on collecting only the necessary information
- **Use clear labels**: Make sure field labels are descriptive and unambiguous
- **Group related fields**: Use fieldsets or sections to group related fields
- **Provide help text**: Use descriptions to provide additional context
- **Use appropriate field types**: Choose the right field type for the data being collected
- **Validate input**: Use validation rules to ensure data integrity

### Task Management

- **Claim tasks promptly**: Claim tasks as soon as you start working on them
- **Complete tasks on time**: Pay attention to due dates and priorities
- **Provide complete information**: Fill out all required fields and provide any necessary context
- **Check task history**: Review the task history to understand the context and previous actions
- **Unclaim tasks if needed**: If you can't complete a task, unclaim it so others can work on it

## Troubleshooting

### Common Form Issues

- **Validation errors**: Check that your input meets the validation rules
- **Missing required fields**: Ensure all required fields are filled out
- **Conditional fields not appearing**: Check that the conditions for displaying the fields are met
- **Widget rendering issues**: Ensure the UI schema is correctly configured

### Common Task Issues

- **Can't claim a task**: Check that the task is assigned to your role and is in the pending state
- **Can't complete a task**: Ensure all required fields are filled out and validation passes
- **Task not appearing in list**: Check your filters and ensure the task is assigned to your role
- **Task history not showing**: Refresh the page or check for permission issues
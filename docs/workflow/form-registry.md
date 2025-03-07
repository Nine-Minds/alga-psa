# Form Registry System

The Form Registry is a centralized system for managing form definitions across the workflow system. It provides a way to define, validate, version, and compose forms that can be used in workflow tasks.

## Features

- **CRUD Operations**: Create, read, update, and delete form definitions
- **Form Validation**: Validate form data against JSON Schema
- **Versioning**: Manage multiple versions of forms
- **Lifecycle Management**: Track form status (draft, active, deprecated, archived)
- **Composition**: Compose forms from multiple form definitions
- **Search and Discovery**: Find forms by name, category, tags, etc.
- **Tagging**: Categorize forms using the existing tag system

## Architecture

The Form Registry consists of the following components:

1. **Form Registry Interfaces**: Define the data structures for form definitions, schemas, and operations
2. **Form Definition Model**: Database model for form metadata
3. **Form Schema Model**: Database model for form schemas (JSON Schema, UI Schema)
4. **Form Validation Service**: Validate form data against JSON Schema
5. **Form Registry Service**: Core service for managing forms
6. **Form Registry Actions**: Server actions for interacting with the Form Registry

## Database Schema

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

## Usage Examples

### Registering a Form

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

### Getting a Form

```typescript
import { getFormAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Get a form by ID
const form = await getFormAction('credit-reimbursement-request');

// Get a specific version of a form
const formV2 = await getFormAction('credit-reimbursement-request', '2.0.0');
```

### Updating a Form

```typescript
import { updateFormAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Update a form
await updateFormAction('credit-reimbursement-request', '1.0.0', {
  name: 'Updated Credit Reimbursement Request',
  description: 'Updated form for requesting credit reimbursements',
  status: FormStatus.ACTIVE,
  jsonSchema: {
    // Updated JSON Schema
  },
  uiSchema: {
    // Updated UI Schema
  }
}, ['reimbursement', 'credit', 'finance', 'updated']);
```

### Creating a New Version

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

### Validating Form Data

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

### Composing Forms

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

### Searching for Forms

```typescript
import { searchFormsAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Search for forms
const searchResults = await searchFormsAction({
  name: 'reimbursement',
  category: 'finance',
  status: FormStatus.ACTIVE,
  tags: ['credit']
}, {
  limit: 10,
  offset: 0
});

console.log(`Found ${searchResults.total} forms`);
console.log('Forms:', searchResults.forms);
console.log('Tags:', searchResults.tags);
```

## Integration with Task Inbox

The Form Registry is designed to work seamlessly with the Task Inbox system. When a task is created, it can reference a form definition from the Form Registry. The Task Inbox UI will then render the form using the JSON Schema and UI Schema from the Form Registry.

```typescript
// Create a task with a form from the Form Registry
const taskResult = await context.actions.createHumanTask({
  taskType: 'approval',
  formId: 'credit-reimbursement-request', // Reference to the form in the Form Registry
  title: 'Approve Credit Reimbursement',
  description: 'Please review and approve this credit reimbursement request',
  priority: 'high',
  assignTo: {
    roles: ['manager']
  },
  contextData: {
    requestId: context.data.get('requestId'),
    amount: context.data.get('amount'),
    customerId: context.data.get('customerId')
  }
});
```

## Migration

A database migration script is provided to create the necessary tables for the Form Registry:

```bash
# Run the migration
npx knex migrate:latest
```

The migration script creates the `workflow_form_definitions` and `workflow_form_schemas` tables.
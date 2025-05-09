# Form Registry System

The Form Registry is a centralized system for managing form definitions across the workflow system. It provides a way to define, validate, version, and compose forms that can be used in workflow tasks, including the QBO Invoice Sync Workflow forms.

## Features

- **CRUD Operations**: Create, read, update, and delete form definitions
- **Form Validation**: Validate form data against JSON Schema
- **Versioning**: Manage multiple versions of forms
- **Lifecycle Management**: Track form status (draft, active, deprecated, archived)
- **Composition**: Compose forms from multiple form definitions, allowing specialized forms to extend base forms
- **Search and Discovery**: Find forms by name, category, tags, etc.
- **Tagging**: Categorize forms using the existing tag system
- **Task Integration**: Associate forms with specific task types via task definitions
- **System Forms**: Globally available form definitions that can be used across all tenants (see [System Forms documentation](../forms/system-forms.md) for details)

## System Forms

System Forms represent shared, reusable form definitions that are available to all tenants within the platform. This concept is analogous to System Workflows as described in the [Workflow System documentation](workflow-system.md).

For comprehensive documentation on System Forms, please refer to the dedicated [System Forms documentation](../forms/system-forms.md).

### Key Characteristics of System Forms

- **Shared Definitions**: System Forms are defined once at the system level and are available to all tenants. These serve as reusable templates for common human task interactions.
- **Tenant-Specific Usage**: While the form *definition* is shared, its *instantiation and data capture* remain tenant-specific, ensuring data isolation. When a human task requiring a form is generated for a specific tenant, it can utilize a System Form definition.
- **Identification**: System Forms are identified by a unique `name` in the `system_workflow_form_definitions` table. The `formId` parameter used when creating human tasks (e.g., in `qboInvoiceSyncWorkflow`) points to this `name`.
- **Usage by Tenant-Specific Workflows**:
  - Tenant-specific workflows (defined in `workflow_registrations`) can utilize System Forms.
  - When a human task is created within a tenant's workflow using a `formId`, the Form Registry service uses the `form_type` field in the task definition to determine which table to query:
    - If `form_type` is 'system', it directly queries the `system_workflow_form_definitions` table.
    - If `form_type` is 'tenant' or not specified, it queries the tenant-specific `workflow_form_definitions` table.
  - This approach is more efficient as it avoids unnecessary fallback queries.
- **Benefits**: This approach reduces the need to duplicate form definitions across tenants, simplifies management of standard forms, and ensures a consistent UX for common tasks system-wide. It aligns with the existing architecture of system-level reusable components.

## Architecture

The Form Registry consists of the following components:

1. **Form Registry Interfaces**: Define the data structures for form definitions, schemas, and operations
2. **Form Definition Model**: Database model for form metadata
3. **Form Schema Model**: Database model for form schemas (JSON Schema, UI Schema)
4. **Form Validation Service**: Validate form data against JSON Schema
5. **Form Registry Service**: Core service for managing forms
6. **Form Registry Actions**: Server actions for interacting with the Form Registry

## Database Schema

The Form Registry uses three main tables:

1. **workflow_form_definitions**: Stores tenant-specific form metadata
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

2. **workflow_form_schemas**: Stores tenant-specific form schemas
   - schema_id: Unique identifier for the schema
   - form_id: Reference to the form definition
   - tenant: Tenant identifier
   - json_schema: JSON Schema for form validation
   - ui_schema: UI Schema for form rendering
   - default_values: Default values for form fields
   - created_at: Creation timestamp
   - updated_at: Last update timestamp

3. **system_workflow_form_definitions**: Stores system-level form definitions
   - definition_id: UUID, Primary Key, default gen_random_uuid()
   - name: TEXT, NOT NULL, UNIQUE - The globally unique identifier for the system form
   - description: TEXT, NULLABLE
   - version: TEXT, NOT NULL
   - status: TEXT, NOT NULL - e.g., 'ACTIVE', 'DRAFT', 'ARCHIVED'
   - category: TEXT, NULLABLE
   - tags: TEXT[], NULLABLE
   - json_schema: JSONB, NOT NULL - Stores the JSON Schema for form validation
   - ui_schema: JSONB, NULLABLE - Stores the UI Schema for form rendering
   - default_values: JSONB, NULLABLE - Default values for form fields
   - created_by: UUID, NULLABLE, Foreign Key to users.id or a system identifier
   - created_at: TIMESTAMPTZ, NOT NULL, default CURRENT_TIMESTAMP
   - updated_at: TIMESTAMPTZ, NOT NULL, default CURRENT_TIMESTAMP

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

// The getFormAction function now uses the form_type field to determine which table to query:
// 1. It first looks up the task definition to get the actual form_id and form_type
// 2. If form_type is 'system', it queries the system_workflow_form_definitions table
// 3. If form_type is 'tenant' or not specified, it queries the workflow_form_definitions table
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

### Form Type in Task Definitions

The `workflow_task_definitions` table now includes a `form_type` field that indicates whether the `formId` refers to a tenant-specific form (`'tenant'`) or a system form (`'system'`). This optimization allows the Form Registry service to directly query the appropriate table without needing to first check the tenant-specific table and then fall back to the system table.

When a human task is created, the `formId` (which is actually the task_definition_id) from the task definition is used to look up the actual form definition:

1. The system first looks up the task definition to get the actual form_id and form_type.
2. Based on the form_type, it directly queries the appropriate table:
   - If `form_type` is `'system'`, it looks for the form in the `system_workflow_form_definitions` table.
   - If `form_type` is `'tenant'` or not specified, it looks for the form in the tenant-specific `workflow_form_definitions` table.

This approach is more efficient as it avoids unnecessary fallback queries and potential issues with foreign key constraints, as each table can have its own foreign key relationship.

### QBO Invoice Sync Integration

The QBO Invoice Sync Workflow creates human tasks with associated forms for error handling. For example:

```typescript
await typedActions.createHumanTask({
  taskType: 'qbo_customer_mapping_lookup_error',
  formId: 'qbo-customer-mapping-lookup-error-form', // Reference to the form in the Form Registry
  title: `Failed QBO Customer Mapping Lookup for Company ID: ${algaCompany.company_id}`,
  details: {
    message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the mapping system or action.`,
    alga_company_id: algaCompany.company_id,
    alga_invoice_id: algaInvoiceId,
    tenant_id: tenant,
    realm_id: realmId,
    workflow_instance_id: executionId,
  },
  assignedUserId: null,
  tenantId: tenant,
});
```

Each task type in the QBO Invoice Sync Workflow has a dedicated form that extends a base form, providing a consistent user experience while accommodating specific task requirements.

## Migration

A database migration script is provided to create the necessary tables for the Form Registry:

```bash
# Run the migration
npx knex migrate:latest
```

The migration script creates the `workflow_form_definitions` and `workflow_form_schemas` tables.

## System Form Registration

To register a System Form, use the `registerSystemWorkflowFormDefinitionAction`:

```typescript
import { registerSystemWorkflowFormDefinitionAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Register a new system form
const definitionId = await registerSystemWorkflowFormDefinitionAction({
  name: 'system-credit-reimbursement-request',
  description: 'System-wide form for requesting credit reimbursements',
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
  },
  defaultValues: {
    date: new Date().toISOString().split('T')[0]
  }
}, ['reimbursement', 'credit', 'finance', 'system']);
```

### QBO Invoice Sync Forms Migration

The QBO Invoice Sync Workflow forms are now registered as System Forms through a dedicated migration script:

```bash
# Run the QBO forms migration
npx knex migrate:up 20250509175818_add_qbo_invoice_sync_forms.cjs --knexfile knexfile.cjs --env migration
```

This migration:

1. Creates the `system_workflow_form_definitions` table.

2. Registers four base generic forms as System Forms:
   - `qbo-mapping-error-form`: For entity mapping errors
   - `qbo-lookup-error-form`: For entity lookup errors
   - `qbo-api-error-form`: For QBO API communication errors
   - `workflow-error-form`: For general workflow execution errors

3. Registers ten specialized forms by extending these base forms:
   - `qbo-customer-mapping-lookup-error-form`
   - `secret-fetch-error-form`
   - `qbo-mapping-error-form-specialized`
   - `qbo-item-lookup-failed-form`
   - `qbo-item-mapping-missing-form`
   - `qbo-item-lookup-internal-error-form`
   - `qbo-invoice-no-items-mapped-form`
   - `qbo-sync-error-form`
   - `workflow-execution-error-form`
   - `internal-workflow-error-form`

4. Creates task definitions that associate each task type with its corresponding form, including the `form_type: 'system'` field to indicate that these forms are System Forms.
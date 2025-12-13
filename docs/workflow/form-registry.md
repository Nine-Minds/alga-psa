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
- **Identification**: System Forms are identified by a unique `name` in the `system_workflow_form_definitions` table. When a human task is created using a `taskType`, the system looks up the corresponding task definition. This task definition then specifies the `form_id` (which is the `name` of the form in `system_workflow_form_definitions` or `workflow_form_definitions`) and `form_type` to be used.
- **Usage by Tenant-Specific Workflows**:
  - Tenant-specific workflows (defined in `workflow_registrations`) can utilize System Forms.
  - When a human task is created using a `taskType`, the system first retrieves the associated task definition (either from `system_workflow_task_definitions` or `workflow_task_definitions`). This task definition contains a `form_id` and a `form_type`. The Form Registry service then uses this `form_type` to determine which form definition table to query:
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

### Enhanced Templating for `default_values` and Schemas

The `default_values` field in both `workflow_form_schemas` and `system_workflow_form_definitions`, as well as other string properties within `json_schema` or `ui_schema` (e.g., `title`, `description`, or `default` values for specific properties), can utilize an enhanced templating mechanism. This system uses Parsimmon to parse and evaluate a controlled, limited set of JavaScript-like expressions within the `${...}` syntax, using `contextData` provided at runtime.

**Supported expressions include:**
*   Variable access (e.g., `${contextData.someKey}`)
*   String literals (e.g., `'default text'`)
*   Logical OR (e.g., `${contextData.optionalValue || 'fallback'}`)
*   Date formatting (e.g., `${new Date(contextData.timestamp).toLocaleDateString()}`)

This allows for more dynamic and context-aware form schemas and default data. For a detailed technical design of this Parsimmon-based templating engine, refer to "[`docs/technical/parsimmon_templating_engine.md`](../technical/parsimmon_templating_engine.md)".
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
  taskType: 'approval', // The taskType implies a pre-defined task definition which links to a form
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

It's important to note that while the Task Inbox primarily interacts with forms pre-registered in the Form Registry (as described above), it also supports tasks whose forms are defined "inline" at the point of task creation within a workflow. In such cases, the system dynamically creates temporary, tenant-specific form definitions and task definitions. The task instance then links to these temporary definitions, allowing the Task Inbox to retrieve and render the form schemas using the same underlying mechanisms. These temporary definitions are typically flagged (e.g., `is_temporary: true`) and are subject to periodic cleanup. For more details on inline forms, see `docs/workflow/inline-form-example.md`.

### Linking Tasks to Forms via Task Definitions

The system now uses a structured approach to link a running workflow task (`workflow_tasks` table) to its corresponding form definition. This involves separate tables for system-level and tenant-specific task definitions.

1.  **Task Definition Tables:**
    *   **`system_workflow_task_definitions`**: Stores definitions for system-wide tasks (e.g., `qbo_mapping_error`). Its primary key is `task_type` (e.g., 'qbo_mapping_error'). Each record contains a `form_id` (the name of the form, e.g., 'qbo-mapping-error-form') and a `form_type` (typically 'system', indicating the form definition is in `system_workflow_form_definitions`).
    *   **`workflow_task_definitions`**: Stores definitions for tenant-specific tasks. Its primary key is `task_definition_id` (a UUID). Each record also contains a `form_id` and `form_type`.

2.  **Linking in `workflow_tasks` Table:**
    The `workflow_tasks` table (which stores instances of running tasks) has the following key columns to link to a task definition:
    *   `task_definition_type` (TEXT): Stores either 'system' or 'tenant'.
    *   `tenant_task_definition_id` (UUID, NULLABLE): Foreign key to `workflow_task_definitions.task_definition_id`. Populated if `task_definition_type` is 'tenant'.
    *   `system_task_definition_task_type` (TEXT, NULLABLE): Foreign key to `system_workflow_task_definitions.task_type`. Populated if `task_definition_type` is 'system'.
    *   A CHECK constraint ensures that only the appropriate foreign key column is populated based on `task_definition_type`.

3.  **Resolving the Form for a Task:**
    When a human task instance needs its form:
    a. The system inspects `workflow_tasks.task_definition_type`.
    b. If 'tenant', it uses `workflow_tasks.tenant_task_definition_id` to look up the record in `workflow_task_definitions`.
    c. If 'system', it uses `workflow_tasks.system_task_definition_task_type` to look up the record in `system_workflow_task_definitions`.
    d. The retrieved task definition record (from either table) contains the `form_id` (the name of the form) and the `form_type` ('system' or 'tenant').
    e. Based on this `form_type`, the Form Registry service queries either `system_workflow_form_definitions` (if `form_type` is 'system') or `workflow_form_definitions` (if `form_type` is 'tenant') using the `form_id` (name) to get the actual form schema.

This refined structure ensures clear separation and robust linking for both system and tenant-specific task and form definitions.

### QBO Invoice Sync Integration

The QBO Invoice Sync Workflow creates human tasks with associated forms for error handling. For example:

```typescript
await typedActions.createHumanTask({
  taskType: 'qbo_customer_mapping_lookup_error', // The form is determined by the task definition associated with this taskType
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
   - `qbo-invoice-no-items-mapped-form`
   - `qbo-sync-error-form`
   - `workflow-execution-error-form`
   - `internal-workflow-error-form`

4. Creates system task definitions in the `system_workflow_task_definitions` table. Each of these definitions associates a system `task_type` (e.g., 'qbo_customer_mapping_lookup_error') with its corresponding `form_id` (e.g., 'qbo-customer-mapping-lookup-error-form') and sets `form_type: 'system'`, indicating the form itself is a System Form defined in `system_workflow_form_definitions`.

# System Forms

System Forms represent shared, reusable form definitions that are available to all tenants within the platform. This concept is analogous to System Workflows as described in the [Workflow System documentation](../workflow/workflow-system.md).

## Overview

System Forms provide a way to define forms once at the system level and make them available to all tenants. This reduces duplication, simplifies management, and ensures a consistent user experience across the platform.

## Key Characteristics

- **Shared Definitions**: System Forms are defined once at the system level and are available to all tenants. These serve as reusable templates for common human task interactions.

- **Tenant-Specific Usage**: While the form *definition* is shared, its *instantiation and data capture* remain tenant-specific, ensuring data isolation. When a human task requiring a form is generated for a specific tenant, it can utilize a System Form definition.

- **Identification**: System Forms are identified by a unique `name` in the `system_workflow_form_definitions` table. When a human task is created using a `taskType`, the system looks up the corresponding task definition. This task definition then specifies the `form_id` (which is the `name` of the form in `system_workflow_form_definitions` or `workflow_form_definitions`) and `form_type` to be used.

- **Usage by Tenant-Specific Workflows**:
  - Tenant-specific workflows (defined in `workflow_registrations`) can utilize System Forms.
  - When a human task is created using a `taskType`, the system first retrieves the associated task definition (either from `system_workflow_task_definitions` or `workflow_task_definitions`). This task definition contains a `form_id` and a `form_type`. The Form Registry service then uses this `form_type` to determine which form definition table to query:
    - If `form_type` is 'system', it directly queries the `system_workflow_form_definitions` table.
    - If `form_type` is 'tenant' or not specified, it queries the tenant-specific `workflow_form_definitions` table.
  - This approach is more efficient as it avoids unnecessary fallback queries.

## Database Schema

System Forms are stored in the `system_workflow_form_definitions` table:

- **definition_id**: UUID, Primary Key, default gen_random_uuid()
- **name**: TEXT, NOT NULL, UNIQUE - The globally unique identifier for the system form
- **description**: TEXT, NULLABLE
- **version**: TEXT, NOT NULL
- **status**: TEXT, NOT NULL - e.g., 'ACTIVE', 'DRAFT', 'ARCHIVED'
- **category**: TEXT, NULLABLE
- **tags**: TEXT[], NULLABLE
- **json_schema**: JSONB, NOT NULL - Stores the JSON Schema for form validation
- **ui_schema**: JSONB, NULLABLE - Stores the UI Schema for form rendering
- **default_values**: JSONB, NULLABLE - Default values for form fields
- **created_by**: UUID, NULLABLE, Foreign Key to users.id or a system identifier
- **created_at**: TIMESTAMPTZ, NOT NULL, default CURRENT_TIMESTAMP
- **updated_at**: TIMESTAMPTZ, NOT NULL, default CURRENT_TIMESTAMP

Unlike tenant-specific forms, which use separate tables for form definitions (`workflow_form_definitions`) and schemas (`workflow_form_schemas`), System Forms combine both aspects in a single table. This approach offers several benefits:

1. **Simplicity**: Reduces table count and simplifies queries for retrieving complete system form definitions.
2. **Consistency**: Aligns with how other system-level entities like `system_workflow_registrations` store their JSONB configuration directly.
3. **Cohesion**: System form definitions and their schemas are typically a single, cohesive unit, making a combined table more natural.

## Form Type in Task Definitions

The `workflow_task_definitions` table includes a `form_type` field that indicates whether the `formId` refers to a tenant-specific form (`'tenant'`) or a system form (`'system'`). This optimization allows the Form Registry service to directly query the appropriate table without needing to first check the tenant-specific table and then fall back to the system table.

When a human task is created using a `taskType`, the system first looks up the corresponding task definition (system or tenant-specific). This task definition contains the `form_id` (the name of the form, e.g., 'qbo-customer-mapping-lookup-error-form') and `form_type` which are then used to retrieve the actual form schema:

1. The system first looks up the task definition to get the actual form_id and form_type.
2. Based on the form_type, it directly queries the appropriate table:
   - If `form_type` is `'system'`, it looks for the form in the `system_workflow_form_definitions` table.
   - If `form_type` is `'tenant'` or not specified, it looks for the form in the tenant-specific `workflow_form_definitions` table.

This approach is more efficient as it avoids unnecessary fallback queries and potential issues with foreign key constraints, as each table can have its own foreign key relationship.

## Registration and Retrieval

### Registering a System Form

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

### Retrieving a Form

The `getFormAction` function now uses the `form_type` field to determine which table to query:

```typescript
import { getFormAction } from 'server/src/lib/actions/workflow-actions/formRegistryActions';

// Get a form by ID (this is actually the task_definition_id)
const form = await getFormAction('credit-reimbursement-request');

// Get a specific version of a form
const formV2 = await getFormAction('credit-reimbursement-request', '2.0.0');
```

The retrieval process:

1. First, it looks up the task definition to get the actual form_id and form_type.
2. Based on the form_type, it directly queries the appropriate table:
   - If form_type is 'system', it queries the `system_workflow_form_definitions` table.
   - If form_type is 'tenant' or not specified, it queries the `workflow_form_definitions` table.

## QBO Invoice Sync Forms

> **Note:** This section is retained for historical reference. Alga PSA no longer uses the legacy QBO workflow-based invoice sync described here for current QuickBooks functionality. The supported QuickBooks path is **QuickBooks CSV** via the shared accounting export pipeline.

The QBO Invoice Sync Workflow forms are registered as System Forms through a dedicated migration script (`20250509175818_add_qbo_invoice_sync_forms.cjs`). This migration:

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

4. Creates task definitions that associate each task type with its corresponding form, including the `form_type: 'system'` field to indicate that these forms are System Forms.

## Benefits

The System Forms approach offers several key benefits:

1. **Reduced Duplication**: Forms only need to be defined once at the system level, rather than for each tenant.
2. **Simplified Management**: Updates to system forms are automatically available to all tenants.
3. **Consistent User Experience**: Ensures a consistent look and feel for common tasks across the platform.
4. **Tenant Customization**: Tenants can still override system forms with their own custom versions if needed.
5. **Architectural Alignment**: Follows the same pattern as other system-level entities like System Workflows.

## Integration with Human Tasks

When creating a human task that requires a form, you can reference a System Form:

```typescript
await typedActions.createHumanTask({
  taskType: 'qbo_mapping_error', // The form is determined by the task definition associated with this taskType
  title: `Failed QBO Customer Mapping Lookup for Company ID: ${algaCompany.company_id}`,
  details: {
    // Task details...
  },
  assignedUserId: null,
  tenantId: tenant,
});
```

The Form Registry service will resolve the form based on the `form_id` and `form_type` found in the task definition, which was looked up using the `taskType` provided during task creation.

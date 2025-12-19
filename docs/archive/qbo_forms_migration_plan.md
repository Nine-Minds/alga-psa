# (Archived) QBO Invoice Sync Forms Migration Plan (for `20250509175818_add_qbo_invoice_sync_forms.cjs`)

**Status:** Archived. Alga PSA no longer uses the legacy QBO workflow-based sync described by this document. The currently supported QuickBooks integration path is **QuickBooks CSV** (manual export/import) via the shared accounting export pipeline.

This document outlines the plan and details for the database migration that registers the System Forms and associated Task Definitions for the QuickBooks Online Invoice Sync workflow. This plan assumes that `FormRegistry.getForm()` will serve schemas as they are stored, without performing server-side resolution of named `$ref`s within `allOf` constructs. Therefore, all schemas stored by this migration must be fully self-contained.

## I. Prerequisites

1.  **`system_workflow_form_definitions` Table**: This table must exist. If not created by a prior migration, this migration should create it.
    *   **Columns**: `definition_id` (UUID PK), `name` (TEXT UNIQUE NOT NULL), `description` (TEXT), `version` (TEXT NOT NULL), `status` (TEXT NOT NULL), `category` (TEXT), `tags` (TEXT[]), `json_schema` (JSONB NOT NULL), `ui_schema` (JSONB), `default_values` (JSONB), `created_by` (UUID), `created_at` (TIMESTAMPTZ NOT NULL), `updated_at` (TIMESTAMPTZ NOT NULL).
2.  **`system_workflow_task_definitions` Table**: This table must exist. If not created by a prior migration, this migration should create it.
    *   **Columns**: `task_type` (TEXT PK), `name` (TEXT NOT NULL), `description` (TEXT), `form_id` (TEXT NOT NULL, references `system_workflow_form_definitions.name`), `form_type` (TEXT NOT NULL, should be 'system'), `default_priority` (TEXT), `default_sla_days` (INTEGER), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ), `created_by` (UUID).
3.  **Helper Functions for Schema Composition**: The migration script will need JavaScript helper functions to compose final schemas from base definitions and extensions. Examples:
    *   `composeSchema(baseJsonSchema, extensionJsonSchema)`
    *   `composeUiSchema(baseUiSchema, extensionUiSchema)`
    *   `composeDefaultValues(baseDefaults, extensionDefaults)`

## II. Migration Script Logic (`exports.up`)

The `up` function will perform the following steps within a transaction:

1.  **Define Base Generic Form Schemas (as JavaScript Objects)**:
    *   `baseQboMappingErrorForm`: For mapping errors.
    *   `baseQboLookupErrorForm`: For lookup errors.
    *   `baseQboApiErrorForm`: For QBO API errors.
    *   `baseWorkflowErrorForm`: For general workflow errors.
    *   *Task 1 (Define Base Schemas)*: Fully define the `jsonSchema`, `uiSchema`, and `defaultValues` for these four base forms.

2.  **Define Specialized QBO Form Extensions (as JavaScript Objects)**:
    For each of the 10 specialized QBO task types, define the "extension" part of their schema – i.e., the properties, UI hints, and default values that are specific to them or override the base.
    *   `qbo-customer-mapping-lookup-error-form` (extends `baseQboMappingErrorForm`)
    *   `secret-fetch-error-form` (extends `baseQboApiErrorForm`)
    *   `qbo-mapping-error-form-specialized` (extends `baseQboMappingErrorForm` - clarify if this name is final or if it's the same as the base)
    *   `qbo-item-lookup-failed-form` (extends `baseQboLookupErrorForm`)
    *   `qbo-item-mapping-missing-form` (extends `baseQboMappingErrorForm`)
    *   `qbo-invoice-no-items-mapped-form` (extends `baseQboMappingErrorForm`)
    *   `qbo-sync-error-form` (extends `baseQboApiErrorForm`)
    *   `workflow-execution-error-form` (extends `baseWorkflowErrorForm`)
    *   `internal-workflow-error-form` (extends `baseWorkflowErrorForm`)
    *   *Task 2 (Define Extensions)*: For each of the 10 forms, detail its specific `jsonSchema` additions/overrides, `uiSchema` additions/overrides, and `defaultValues` additions/overrides.

3.  **Compose and Register Specialized Forms into `system_workflow_form_definitions`**:
    Iterate through the 10 specialized form definitions:
    *   Use the helper functions to compose the `finalJsonSchema`, `finalUiSchema`, and `finalDefaultValues` from the appropriate base and the specific extension.
    *   Insert a new record into `system_workflow_form_definitions` with:
        *   `name`: The specialized form name (e.g., 'qbo-customer-mapping-lookup-error-form').
        *   `json_schema`: The `finalJsonSchema` (fully self-contained).
        *   `ui_schema`: The `finalUiSchema`.
        *   `default_values`: The `finalDefaultValues`.
        *   Other metadata: `version`, `status`, `description`, `category`, `created_by`, etc.
    *   *Task 3 (created_by Value)*: Determine the appropriate value for `created_by` for these system records.

4.  **Create/Update `system_workflow_task_definitions`**:
    For each of the 10 specialized forms registered:
    *   Insert/update a record in `system_workflow_task_definitions`.
    *   `task_type`: The corresponding workflow task type string (e.g., 'qbo_sync_error').
    *   `name`: A descriptive name for the task definition.
    *   `description`: From the form definition.
    *   `form_id`: The `name` of the specialized system form just registered.
    *   `form_type`: Set explicitly to `'system'`.
    *   Other defaults like `default_priority`.
    *   Handle conflicts on `task_type` (e.g., using `.onConflict('task_type').merge()`).

## III. Migration Script Logic (`exports.down`)

The `down` function will perform the following steps within a transaction:

1.  **Delete `system_workflow_task_definitions`**: Delete records for the 10 QBO task types.
2.  **Delete `system_workflow_form_definitions`**: Delete records for the 10 specialized QBO form names.
3.  (Optional) Drop tables if this migration created them and no other data relies on them.

## IV. Unanswered Questions & Further Tasks

*   **Task 1 (Define Base Schemas)**: Provide complete `jsonSchema`, `uiSchema`, and `defaultValues` for:
    *   `baseQboMappingErrorForm`
    *   `baseQboLookupErrorForm`
    *   `baseQboApiErrorForm`
    *   `baseWorkflowErrorForm`
*   **Task 2 (Define Extensions)**: For each of the 10 specialized QBO forms, provide their specific schema "extension" parts relative to their base.
    *   Example for `qbo-customer-mapping-lookup-error-form`:
        *   `extension.jsonSchema.properties`: `{ algaCustomerId: { type: 'string', title: 'Alga Customer ID', readOnly: true }, guidance: { type: 'string', title: 'Guidance', default: 'Please check customer mapping in QBO settings.', readOnly: true } }`
        *   `extension.jsonSchema.required`: `['algaCustomerId']` (in addition to base's required)
        *   `extension.uiSchema`: `{ 'ui:order': ['errorMessage', 'algaCustomerId', 'guidance', 'resolutionNotes', '*'] }`
        *   `extension.defaultValues`: `{ guidanceText: "Ensure the customer exists in QBO and is correctly mapped." }`
    *   ... (Repeat for all 10 forms) ...
*   **Task 3 (created_by Value)**: Decide on a consistent `created_by` value (e.g., a specific system user UUID, or `null`) for records inserted by migrations.
*   **Task 4 (Schema Composition Helpers)**: Review and refine the `composeSchema`, `composeUiSchema`, and `composeDefaultValues` JavaScript helper functions within the migration script to ensure they correctly merge all aspects of the schemas as intended (especially `ui:order`, nested objects, etc.).
*   **Task 5 (Table Creation)**: Confirm if `system_workflow_form_definitions` and `system_workflow_task_definitions` tables are created by this migration or a preceding one. Adjust `up`/`down` accordingly.
*   **Task 6 (Base Form Registration)**: Decide if the "base generic forms" should themselves be registered as separate entries in `system_workflow_form_definitions` or if they only exist as JS objects for composition within this migration.
*   **Task 7 (Form Name "qbo-mapping-error-form-specialized")**: Clarify if "qbo-mapping-error-form-specialized" is a distinct form or if it refers to the general "qbo-mapping-error-form" which itself is composed. The task data implies "qbo-mapping-error-form" is the one being used and is composed. Ensure naming consistency.
*   **Task 8 (Verify `qboInvoiceSyncWorkflow.ts`)**: Confirm that `qboInvoiceSyncWorkflow.ts` correctly uses the `taskType` when calling `create_human_task`, and that these `taskType`s will match the `task_type` entries created in `system_workflow_task_definitions` by this migration. No `formId` parameter should be passed from the workflow.

## V. Conceptual Code for Migration (Illustrative)

```javascript
// server/migrations/20250509175818_add_qbo_invoice_sync_forms.cjs

// Helper function for merging/composing schemas (simplified example)
function composeSchema(baseJsonSchema, extensionJsonSchema) {
  // ... implementation ...
}
function composeUiSchema(baseUiSchema = {}, extensionUiSchema = {}) {
  // ... implementation ...
}
function composeDefaultValues(baseDefaults = {}, extensionDefaults = {}) {
  // ... implementation ...
}

exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // TODO: Implement table creation for system_workflow_form_definitions if needed (Task 5)
    // TODO: Implement table creation for system_workflow_task_definitions if needed (Task 5)

    // --- Define Base Schemas (Task 1) ---
    const baseQboMappingErrorForm = { jsonSchema: {/*...*/}, uiSchema: {/*...*/}, defaultValues: {/*...*/} };
    // ... other base forms ...

    // --- Define Specialized Form Extensions & Register (Task 2) ---
    const specializedFormsData = [
      {
        name: 'qbo-customer-mapping-lookup-error-form',
        taskType: 'qbo_customer_mapping_lookup_error',
        baseSchemaRef: baseQboMappingErrorForm,
        extension: { jsonSchema: {/*...*/}, uiSchema: {/*...*/}, defaultValues: {/*...*/} },
        description: 'Form for QBO customer mapping lookup errors.'
      },
      // ... other 9 forms ...
    ];

    for (const formData of specializedFormsData) {
      const finalJsonSchema = composeSchema(formData.baseSchemaRef.jsonSchema, formData.extension.jsonSchema);
      const finalUiSchema = composeUiSchema(formData.baseSchemaRef.uiSchema, formData.extension.uiSchema);
      const finalDefaultValues = composeDefaultValues(formData.baseSchemaRef.defaultValues, formData.extension.defaultValues);

      await trx('system_workflow_form_definitions').insert({
        name: formData.name,
        version: '1.0', status: 'ACTIVE', description: formData.description,
        json_schema: finalJsonSchema,
        ui_schema: finalUiSchema,
        default_values: finalDefaultValues,
        // created_by: (Task 3)
        created_at: new Date(), updatedAt: new Date()
      });

      await trx('system_workflow_task_definitions').insert({
        task_type: formData.taskType,
        name: `Handle ${formData.taskType}`, description: formData.description,
        form_id: formData.name,
        form_type: 'system',
        // created_by: (Task 3)
        created_at: new Date(), updatedAt: new Date()
      }).onConflict('task_type').merge();
    }
    // TODO: Decide on base form registration (Task 6)
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // ... implementation based on specializedFormsData names and taskTypes ...
  });
};

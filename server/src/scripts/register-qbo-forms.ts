import { FormRegistry } from '@alga/form-registry';
import { TaskRegistry } from '@alga/task-registry';

// Import base form definitions
import { qboMappingErrorForm } from '../lib/forms/base-forms/qbo-mapping-error-form';
import { qboLookupErrorForm } from '../lib/forms/base-forms/qbo-lookup-error-form';
import { qboApiErrorForm } from '../lib/forms/base-forms/qbo-api-error-form';
import { workflowErrorForm } from '../lib/forms/base-forms/workflow-error-form';

// Import specialized form definitions (placeholders for composition)
import { qboCustomerMappingLookupErrorForm } from '../lib/forms/specialized-forms/qbo-customer-mapping-lookup-error-form';
import { secretFetchErrorForm } from '../lib/forms/specialized-forms/secret-fetch-error-form';
import { qboMappingErrorFormSpecialized } from '../lib/forms/specialized-forms/qbo-mapping-error-form-specialized';
import { qboItemLookupFailedForm } from '../lib/forms/specialized-forms/qbo-item-lookup-failed-form';
import { qboItemMappingMissingForm } from '../lib/forms/specialized-forms/qbo-item-mapping-missing-form';
import { qboItemLookupInternalErrorForm } from '../lib/forms/specialized-forms/qbo-item-lookup-internal-error-form';
import { qboInvoiceNoItemsMappedForm } from '../lib/forms/specialized-forms/qbo-invoice-no-items-mapped-form';
import { qboSyncErrorForm } from '../lib/forms/specialized-forms/qbo-sync-error-form';
import { workflowExecutionErrorForm } from '../lib/forms/specialized-forms/workflow-execution-error-form';
import { internalWorkflowErrorForm } from '../lib/forms/specialized-forms/internal-workflow-error-form';

// Import task definitions
import { qboInvoiceSyncTaskDefinitions } from '../lib/task-definitions/qbo-invoice-sync-task-definitions';

// Instantiate registries (assuming singleton instances are available globally or via import)
// Replace with actual registry access if different
const formRegistry = new FormRegistry(); // Or get existing instance
const taskRegistry = new TaskRegistry(); // Or get existing instance

async function registerQboFormsAndTasks() {
  // 1. Register base forms
  formRegistry.registerForm(qboMappingErrorForm);
  formRegistry.registerForm(qboLookupErrorForm);
  formRegistry.registerForm(qboApiErrorForm);
  formRegistry.registerForm(workflowErrorForm);

  // 2. Compose and register specialized forms
  // Note: This is a simplified composition. A real-world scenario might involve
  // merging schemas and uiSchemas more intelligently.
  const specializedForms = [
    { base: qboMappingErrorForm, specialized: qboCustomerMappingLookupErrorForm },
    { base: workflowErrorForm, specialized: secretFetchErrorForm },
    { base: qboMappingErrorForm, specialized: qboMappingErrorFormSpecialized },
    { base: qboLookupErrorForm, specialized: qboItemLookupFailedForm },
    { base: qboMappingErrorForm, specialized: qboItemMappingMissingForm },
    { base: qboLookupErrorForm, specialized: qboItemLookupInternalErrorForm },
    { base: qboMappingErrorForm, specialized: qboInvoiceNoItemsMappedForm },
    { base: qboApiErrorForm, specialized: qboSyncErrorForm },
    { base: workflowErrorForm, specialized: workflowExecutionErrorForm },
    { base: workflowErrorForm, specialized: internalWorkflowErrorForm },
  ];

  for (const { base, specialized } of specializedForms) {
    // Simple composition: merge properties and required fields
    const composedForm = {
      ...specialized,
      jsonSchema: {
        ...specialized.jsonSchema,
        properties: {
          ...base.jsonSchema.properties,
          ...specialized.jsonSchema.properties,
        },
        required: [
          ...(base.jsonSchema.required || []),
          ...(specialized.jsonSchema.required || []),
        ],
      },
      uiSchema: {
        ...base.uiSchema,
        ...specialized.uiSchema,
      },
    };
    formRegistry.registerForm(composedForm);
  }

  // 3. Register task definitions
  qboInvoiceSyncTaskDefinitions.forEach(taskDefinition => {
    taskRegistry.registerTask(taskDefinition);
  });

  console.log('QBO Invoice Sync forms and tasks registered successfully.');
}

registerQboFormsAndTasks().catch(console.error);
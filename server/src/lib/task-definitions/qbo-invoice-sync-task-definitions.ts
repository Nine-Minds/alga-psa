import { TaskDefinition } from '@alga/task-registry';

export const qboInvoiceSyncTaskDefinitions: TaskDefinition[] = [
  {
    name: 'qbo_customer_mapping_lookup_error',
    description: 'Task for handling QBO customer mapping lookup errors.',
    formName: 'QBO Customer Mapping Lookup Error Form',
  },
  {
    name: 'secret_fetch_error',
    description: 'Task for handling secret fetch errors.',
    formName: 'Secret Fetch Error Form',
  },
  {
    name: 'qbo_mapping_error',
    description: 'Task for handling generic QBO mapping errors.',
    formName: 'QBO Mapping Error Form Specialized',
  },
  {
    name: 'qbo_item_lookup_failed',
    description: 'Task for handling QBO item lookup failures.',
    formName: 'QBO Item Lookup Failed Form',
  },
  {
    name: 'qbo_item_mapping_missing',
    description: 'Task for handling missing QBO item mappings.',
    formName: 'QBO Item Mapping Missing Form',
  },
  {
    name: 'qbo_item_lookup_internal_error',
    description: 'Task for handling internal QBO item lookup errors.',
    formName: 'QBO Item Lookup Internal Error Form',
  },
  {
    name: 'qbo_invoice_no_items_mapped',
    description: 'Task for handling QBO invoices with no items mapped.',
    formName: 'QBO Invoice No Items Mapped Form',
  },
  {
    name: 'qbo_sync_error',
    description: 'Task for handling QBO sync errors.',
    formName: 'QBO API Error Form', // Using the base API error form for sync errors
  },
  {
    name: 'workflow_execution_error',
    description: 'Task for handling workflow execution errors.',
    formName: 'Workflow Error Form', // Using the base Workflow error form
  },
  {
    name: 'internal_workflow_error',
    description: 'Task for handling internal workflow errors.',
    formName: 'Workflow Error Form', // Using the base Workflow error form
  },
];
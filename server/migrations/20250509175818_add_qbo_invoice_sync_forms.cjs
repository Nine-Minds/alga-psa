exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Create system_workflow_form_definitions table
    await trx.schema.createTable('system_workflow_form_definitions', (table) => {
      table.uuid('definition_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable().unique();
      table.text('description');
      table.text('version').notNullable();
      table.text('status').notNullable(); // e.g., 'ACTIVE', 'DRAFT', 'ARCHIVED'
      table.text('category');
      table.specificType('tags', 'TEXT[]');
      table.jsonb('json_schema').notNullable();
      table.jsonb('ui_schema');
      table.jsonb('default_values');
      table.text('created_by'); // Allow string values like 'system'
      table.timestamps(true, true); // created_at and updated_at with defaults
    });

    // Base Form Definitions
    const baseForms = [
      {
        name: 'qbo-mapping-error-form',
        description: 'Generic form for QBO mapping errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          properties: {
            errorMessage: { type: 'string', title: 'Error Message', readOnly: true },
            workflowInstanceId: { type: 'string', title: 'Workflow Instance ID', readOnly: true },
            algaInvoiceId: { type: 'string', title: 'Alga Invoice ID', readOnly: true },
            entityId: { type: 'string', title: 'Entity ID', readOnly: true },
            resolutionStatus: {
              type: 'string',
              title: 'Resolution Status',
              enum: ['resolved', 'escalated', 'deferred']
            },
            resolutionNotes: { type: 'string', title: 'Resolution Notes' },
            createMapping: { type: 'boolean', title: 'Create Mapping' }
          },
          required: ['errorMessage', 'workflowInstanceId', 'resolutionStatus']
        }),
        ui_schema: JSON.stringify({
          errorMessage: { 'ui:widget': 'textarea' },
          resolutionNotes: { 'ui:widget': 'textarea' }
        }),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-lookup-error-form',
        description: 'Generic form for QBO lookup errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          properties: {
            errorMessage: { type: 'string', title: 'Error Message', readOnly: true },
            workflowInstanceId: { type: 'string', title: 'Workflow Instance ID', readOnly: true },
            algaInvoiceId: { type: 'string', title: 'Alga Invoice ID', readOnly: true },
            algaServiceId: { type: 'string', title: 'Alga Service ID', readOnly: true },
            resolutionStatus: {
              type: 'string',
              title: 'Resolution Status',
              enum: ['resolved', 'escalated', 'deferred']
            },
            resolutionNotes: { type: 'string', title: 'Resolution Notes' },
            retryLookup: { type: 'boolean', title: 'Retry Lookup' }
          },
          required: ['errorMessage', 'workflowInstanceId', 'resolutionStatus']
        }),
        ui_schema: JSON.stringify({
          errorMessage: { 'ui:widget': 'textarea' },
          resolutionNotes: { 'ui:widget': 'textarea' }
        }),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-api-error-form',
        description: 'Generic form for QBO API errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          properties: {
            errorMessage: { type: 'string', title: 'Error Message', readOnly: true },
            errorCode: { type: 'string', title: 'Error Code', readOnly: true },
            workflowInstanceId: { type: 'string', title: 'Workflow Instance ID', readOnly: true },
            algaInvoiceId: { type: 'string', title: 'Alga Invoice ID', readOnly: true },
            qboInvoiceId: { type: 'string', title: 'QBO Invoice ID', readOnly: true },
            resolutionStatus: {
              type: 'string',
              title: 'Resolution Status',
              enum: ['resolved', 'escalated', 'deferred']
            },
            resolutionNotes: { type: 'string', title: 'Resolution Notes' },
            retryOperation: { type: 'boolean', title: 'Retry Operation' }
          },
          required: ['errorMessage', 'workflowInstanceId', 'resolutionStatus']
        }),
        ui_schema: JSON.stringify({
          errorMessage: { 'ui:widget': 'textarea' },
          resolutionNotes: { 'ui:widget': 'textarea' }
        }),
        default_values: JSON.stringify({})
      },
      {
        name: 'workflow-error-form',
        description: 'Generic form for workflow execution errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          properties: {
            errorMessage: { type: 'string', title: 'Error Message', readOnly: true },
            errorStackTrace: { type: 'string', title: 'Error Stack Trace', readOnly: true },
            workflowInstanceId: { type: 'string', title: 'Workflow Instance ID', readOnly: true },
            algaInvoiceId: { type: 'string', title: 'Alga Invoice ID', readOnly: true },
            resolutionStatus: {
              type: 'string',
              title: 'Resolution Status',
              enum: ['resolved', 'escalated', 'deferred']
            },
            resolutionNotes: { type: 'string', title: 'Resolution Notes' },
            restartWorkflow: { type: 'boolean', title: 'Restart Workflow' }
          },
          required: ['errorMessage', 'workflowInstanceId', 'resolutionStatus']
        }),
        ui_schema: JSON.stringify({
          errorMessage: { 'ui:widget': 'textarea' },
          errorStackTrace: { 'ui:widget': 'textarea' },
          resolutionNotes: { 'ui:widget': 'textarea' }
        }),
        default_values: JSON.stringify({})
      }
    ];

    // Specialized Form Definitions and Schemas (using composition)
    const specializedForms = [
      {
        name: 'qbo-customer-mapping-lookup-error-form',
        description: 'Form for QBO customer mapping lookup errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-mapping-error-form' },
            {
              properties: {
                algaCompanyId: { type: 'string', title: 'Alga Company ID', readOnly: true }
              }
            }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'secret-fetch-error-form',
        description: 'Form for secret fetch errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'workflow-error-form' }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-item-lookup-failed-form',
        description: 'Form for QBO item lookup failed errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-lookup-error-form' },
            {
              properties: {
                algaItemId: { type: 'string', title: 'Alga Item ID', readOnly: true }
              }
            }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-item-mapping-missing-form',
        description: 'Form for QBO item mapping missing errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-mapping-error-form' },
            {
              properties: {
                algaItemId: { type: 'string', title: 'Alga Item ID', readOnly: true }
              }
            }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-item-lookup-internal-error-form',
        description: 'Form for QBO item lookup internal errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-lookup-error-form' },
            {
              properties: {
                algaItemId: { type: 'string', title: 'Alga Item ID', readOnly: true }
              }
            }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-invoice-no-items-mapped-form',
        description: 'Form for QBO invoice no items mapped errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-mapping-error-form' }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'qbo-sync-error-form',
        description: 'Form for QBO sync errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'qbo-api-error-form' }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'workflow-execution-error-form',
        description: 'Form for workflow execution errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'workflow-error-form' }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      },
      {
        name: 'internal-workflow-error-form',
        description: 'Form for internal workflow errors',
        version: '1.0.0',
        status: 'active',
        category: 'error-handling',
        created_by: 'system', // Keep as string for now based on current data
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        json_schema: JSON.stringify({
          type: 'object',
          allOf: [
            { '$ref': 'workflow-error-form' }
          ]
        }),
        ui_schema: JSON.stringify({}),
        default_values: JSON.stringify({})
      }
    ];

    // Combine base and specialized forms
    const systemForms = [
      ...baseForms,
      ...specializedForms
    ];

    // Insert all system forms into the new table
    for (const form of systemForms) {
      await trx('system_workflow_form_definitions').insert(form);
    }

    // Drop incorrect foreign key constraint if it exists
    await trx.schema.table('workflow_task_definitions', (table) => {
      table.dropForeign('form_id', 'workflow_task_definitions_form_id_foreign');
    }).catch(() => {}); // Ignore error if constraint doesn't exist

    // Task Definitions
    const taskDefinitions = [
      {
        task_definition_id: 'qbo_customer_mapping_lookup_error',
        tenant: 'system',
        task_type: 'qbo_customer_mapping_lookup_error',
        name: 'QBO Customer Mapping Lookup Error',
        description: 'Error occurred when looking up QBO customer mapping',
        form_id: 'qbo-customer-mapping-lookup-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'secret_fetch_error',
        tenant: 'system',
        task_type: 'secret_fetch_error',
        name: 'Secret Fetch Error',
        description: 'Error occurred while fetching a secret',
        form_id: 'secret-fetch-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_mapping_error',
        tenant: 'system',
        task_type: 'qbo_mapping_error',
        name: 'QBO Mapping Error',
        description: 'Generic QBO mapping error',
        form_id: 'qbo-mapping-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_item_lookup_failed',
        tenant: 'system',
        task_type: 'qbo_item_lookup_failed',
        name: 'QBO Item Lookup Failed',
        description: 'QBO item lookup failed',
        form_id: 'qbo-item-lookup-failed-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_item_mapping_missing',
        tenant: 'system',
        task_type: 'qbo_item_mapping_missing',
        name: 'QBO Item Mapping Missing',
        description: 'QBO item mapping is missing',
        form_id: 'qbo-item-mapping-missing-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_item_lookup_internal_error',
        tenant: 'system',
        task_type: 'qbo_item_lookup_internal_error',
        name: 'QBO Item Lookup Internal Error',
        description: 'Internal error during QBO item lookup',
        form_id: 'qbo-item-lookup-internal-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_invoice_no_items_mapped',
        tenant: 'system',
        task_type: 'qbo_invoice_no_items_mapped',
        name: 'QBO Invoice No Items Mapped',
        description: 'QBO invoice has no items mapped',
        form_id: 'qbo-invoice-no-items-mapped-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'qbo_sync_error',
        tenant: 'system',
        task_type: 'qbo_sync_error',
        name: 'QBO Sync Error',
        description: 'Generic QBO sync error',
        form_id: 'qbo-sync-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'workflow_execution_error',
        tenant: 'system',
        task_type: 'workflow_execution_error',
        name: 'Workflow Execution Error',
        description: 'Generic workflow execution error',
        form_id: 'workflow-execution-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      },
      {
        task_definition_id: 'internal_workflow_error',
        tenant: 'system',
        task_type: 'internal_workflow_error',
        name: 'Internal Workflow Error',
        description: 'Internal workflow error',
        form_id: 'internal-workflow-error-form',
        default_priority: 'high',
        default_sla_days: 1,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      }
    ];

    for (const task of taskDefinitions) {
      await trx('workflow_task_definitions').insert(task);
    }
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Task Definitions
    const taskDefinitionIds = [
      'qbo_customer_mapping_lookup_error',
      'secret_fetch_error',
      'qbo_mapping_error',
      'qbo_item_lookup_failed',
      'qbo_item_mapping_missing',
      'qbo_item_lookup_internal_error',
      'qbo_invoice_no_items_mapped',
      'qbo_sync_error',
      'workflow_execution_error',
      'internal_workflow_error'
    ];
    await trx('workflow_task_definitions').whereIn('task_definition_id', taskDefinitionIds).del();

    // System Form Definitions
    const systemFormNames = [
      'qbo-mapping-error-form',
      'qbo-lookup-error-form',
      'qbo-api-error-form',
      'workflow-error-form',
      'qbo-customer-mapping-lookup-error-form',
      'secret-fetch-error-form',
      'qbo-item-lookup-failed-form',
      'qbo-item-mapping-missing-form',
      'qbo-item-lookup-internal-error-form',
      'qbo-invoice-no-items-mapped-form',
      'qbo-sync-error-form',
      'workflow-execution-error-form',
      'internal-workflow-error-form'
    ];
    await trx('system_workflow_form_definitions').whereIn('name', systemFormNames).del();

    // Drop the new table
    await trx.schema.dropTableIfExists('system_workflow_form_definitions');
  });
};

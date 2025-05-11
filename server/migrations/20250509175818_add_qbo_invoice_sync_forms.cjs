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

    // The attempt to drop 'workflow_task_definitions_form_id_foreign' has been removed.
    // If this foreign key needs to be managed, it should be done by a migration
    // that specifically addresses the state and constraints of workflow_task_definitions.form_id.
    // This migration's primary focus is the creation and population of system_workflow_form_definitions.
    
    // Task Definitions are now handled by the new refactor_system_task_definitions migration.
    // This section is intentionally left blank.
    // The new migration will ensure these definitions are created in the `system_workflow_task_definitions` table.
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // This migration (20250509175818_add_qbo_invoice_sync_forms) is primarily responsible for
    // creating `system_workflow_form_definitions` and populating it.
    // It should NOT be responsible for cleaning up task definitions from `system_workflow_task_definitions`
    // or `workflow_task_definitions` as that is handled by the `refactor_system_task_definitions` migration.
    // So, we remove the task definition cleanup logic from this `down` method.

    // System Form Definitions - this is correct, as this migration's `up` creates them.
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

'use strict';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    console.log('Starting consolidated QBO workflow schema migration (UP)...');

    // --- Phase 0: Clear existing workflow-related tables as per user feedback ---
    // Drop dependent tables first
    await trx.raw('DROP TABLE IF EXISTS "workflow_task_history" CASCADE;'); // Drop history first if it depends on workflow_tasks
    console.log('Dropped workflow_task_history table (if it existed) with CASCADE.');
    await trx.raw('DROP TABLE IF EXISTS "workflow_tasks" CASCADE;');
    console.log('Dropped workflow_tasks table (if it existed) with CASCADE.');
    
    await trx.raw('DROP TABLE IF EXISTS "system_workflow_task_definitions" CASCADE;'); // Has FK to system_workflow_form_definitions
    console.log('Dropped system_workflow_task_definitions table (if it existed) with CASCADE.');
    
    await trx.raw('DROP TABLE IF EXISTS "system_workflow_form_definitions" CASCADE;');
    console.log('Dropped system_workflow_form_definitions table (if it existed) with CASCADE.');
    
    await trx.raw('DROP TABLE IF EXISTS "workflow_task_definitions" CASCADE;'); // Tenant-specific definitions
    console.log('Dropped workflow_task_definitions (tenant-specific) table (if it existed).');

    // --- Phase 1: Create and Populate System Workflow Tables ---

    // 1.A. Create system_workflow_form_definitions table
    await trx.schema.createTable('system_workflow_form_definitions', (table) => {
      table.uuid('definition_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').unique().notNullable();
      table.text('description');
      table.text('version').notNullable().defaultTo('1.0');
      table.text('status').notNullable().defaultTo('ACTIVE');
      table.text('category');
      table.specificType('tags', 'TEXT[]');
      table.jsonb('json_schema').notNullable();
      table.jsonb('ui_schema');
      table.jsonb('default_values');
      table.uuid('created_by').nullable(); // System records might not have a user creator
      table.timestamps(true, true);
    });
    console.log('Recreated system_workflow_form_definitions table.');

    // Define all form schemas as named objects
    // Enhanced qbo-mapping-error-form schema (from original qbo-item-mapping-missing-form)
    const enhancedQboMappingErrorFormSchema = {
      json_schema: {
        "type": "object",
        "properties": {
          "instructions": { "type": "string", "title": "Action Required", "description": "Please follow these steps to resolve the missing product mapping:", "readOnly": true },
          "quickbooksSetupLink": { "type": "string", "title": "QuickBooks Integration Setup", "format": "uri", "description": "Click here to open the QuickBooks integration setup page" },
          "productDetails": { "type": "string", "title": "Product Details", "description": "Create a mapping for this product in QuickBooks", "readOnly": true },
        },
        "required": []
      },
      ui_schema: {
        "instructions": { "ui:widget": "AlertWidget", "ui:options": { "alertType": "info" } },
        "quickbooksSetupLink": { "ui:widget": "ButtonLinkWidget", "ui:options": { "buttonText": "Go to QuickBooks Integration Setup", "target": "_blank" } },
        "productDetails": { "ui:widget": "HighlightWidget" },
        "ui:order": ["instructions", "productDetails", "quickbooksSetupLink"]
      },
      default_values: {
        "instructions": "Action Required: Please create a mapping in QuickBooks for product '${contextData.service_name}' from company '${contextData.company_name}'. This mapping is required before the invoice can be synced.",
        "quickbooksSetupLink": "/settings/integrations/quickbooks/${contextData.tenant_id}/${contextData.realm_id}/mappings",
        "productDetails": "Product: ${contextData.service_name} (ID: ${contextData.alga_service_id})\nCompany: ${contextData.company_name} (ID: ${contextData.alga_company_id})\n\nThis product needs to be mapped to a corresponding QuickBooks item. Please go to the QuickBooks Integration Setup page using the button below and create this mapping.",
      }
    };

    const genericNeedsAttentionForm = {
      json_schema: {
        type: "object",
        properties: {
          message: { type: "string", title: "Message", readOnly: true },
          alertType: {
            type: "string",
            title: "Alert Type",
            enum: ["info", "warning", "error", "success"],
            default: "error"
          }
        },
        required: ["message"]
      },
      ui_schema: {
        message: {
          "ui:widget": "AlertWidget",
          "ui:options": {
            "alertType": "error"
          }
        },
        alertType: {
          "ui:widget": "hidden"
        }
      },
      default_values: {
        message: "An issue needs your attention. \n\n${contextData.message}",
        alertType: "error"
      }
    }

    const formsToInsert = [
      { name: 'qbo-mapping-error-form', description: 'Generic form for QBO mapping errors (customer or item).', ...enhancedQboMappingErrorFormSchema },
      { name: 'generic-workflow-error-form', description: 'Form for internal workflow errors.', ...genericNeedsAttentionForm },
    ];
    for (const form of formsToInsert) {
      await trx('system_workflow_form_definitions').insert({ ...form, version: '1.0', status: 'ACTIVE', created_by: null, created_at: new Date(),updated_at: new Date() });
    }
    console.log('Populated system_workflow_form_definitions table.');

    // 1.B. Create system_workflow_task_definitions table
    await trx.schema.createTable('system_workflow_task_definitions', (table) => {
      table.text('task_type').primary();
      table.text('name').notNullable();
      table.text('description');
      table.text('form_id').notNullable();
      table.foreign('form_id').references('name').inTable('system_workflow_form_definitions').onDelete('RESTRICT').onUpdate('CASCADE');
      table.text('form_type').notNullable().defaultTo('system');
      table.text('default_priority');
      table.integer('default_sla_days');
      table.uuid('created_by').nullable();
      table.timestamps(true, true);
    });
    console.log('Recreated system_workflow_task_definitions table.');

    const tasksToInsert = [
      { task_type: 'qbo_mapping_error', name: 'Handle QBO Mapping Error', description: 'Generic form for QBO mapping errors (customer or item).', form_id: 'qbo-mapping-error-form' },
      { task_type: 'workflow_error', name: 'Handle Workflow Error', description: 'Form for workflow errors.', form_id: 'generic-workflow-error-form' },
    ];
    for (const task of tasksToInsert) {
      await trx('system_workflow_task_definitions').insert({ ...task, form_type: 'system', created_by: null, created_at: new Date(), updated_at: new Date() });
    }
    console.log('Populated system_workflow_task_definitions table.');

    // --- Phase 2: Create Tenant-Specific and Instance Tables (Fresh) ---
    // 2.A. Create workflow_task_definitions table (tenant-specific)
    await trx.schema.createTable('workflow_task_definitions', (table) => {
      table.uuid('task_definition_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('tenant').notNullable(); // Changed from tenant_id (UUID) to tenant (TEXT)
      // Example: table.foreign('tenant').references('id_string_column').inTable('tenants').onDelete('CASCADE');
      table.text('name').notNullable();
      table.text('description');
      table.text('form_id'); // Can reference a system_workflow_form_definitions.name or a tenant-specific form ID
      table.text('form_type').notNullable().defaultTo('tenant'); // 'tenant' or 'system'
      table.text('default_priority');
      table.integer('default_sla_days');
      table.uuid('created_by'); // User who created this tenant-specific definition
      table.timestamps(true, true);
      table.unique(['tenant', 'name']); // Ensure name is unique per tenant
    });
    console.log('Recreated workflow_task_definitions (tenant-specific) table.');

    // 2.B. Create workflow_tasks table
    await trx.schema.createTable('workflow_tasks', (table) => {
      table.uuid('task_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('tenant').notNullable(); // Changed from tenant_id (UUID) to tenant (TEXT)
      // Example: table.foreign('tenant').references('id_string_column').inTable('tenants').onDelete('CASCADE');
      table.uuid('execution_id').notNullable();
      // Example: table.foreign('execution_id').references('execution_id').inTable('workflow_executions').onDelete('CASCADE');
      
      table.text('task_definition_type').notNullable(); // 'system' or 'tenant'
      
      table.text('system_task_definition_task_type').nullable();
      table.foreign('system_task_definition_task_type', 'fk_wt_system_task_def_type') // Named FK
           .references('task_type').inTable('system_workflow_task_definitions')
           .onDelete('SET NULL').onUpdate('CASCADE');
      
      table.uuid('tenant_task_definition_id').nullable();
      table.foreign('tenant_task_definition_id', 'fk_wt_tenant_task_def_id') // Named FK
           .references('task_definition_id').inTable('workflow_task_definitions')
           .onDelete('SET NULL').onUpdate('CASCADE');

      table.text('title').notNullable();
      table.text('description').nullable();
      table.uuid('event_id').nullable(); // Added event_id
      table.jsonb('context_data').nullable(); // Renamed from 'data'
      table.text('status').notNullable();
      table.text('priority').nullable(); // Renamed from 'priority_override', changed type
      table.jsonb('assigned_roles').nullable();
      table.jsonb('assigned_users').nullable();
      table.timestamp('due_date').nullable(); // Renamed from 'due_at'
      table.timestamp('completed_at').nullable();
      table.jsonb('response_data').nullable();
      table.uuid('created_by').nullable();
      // table.foreign('created_by').references('user_id').inTable('users'); // Example if users table exists

      table.timestamps(true, true);

      table.check(`
        (task_definition_type = 'tenant' AND tenant_task_definition_id IS NOT NULL AND system_task_definition_task_type IS NULL) OR
        (task_definition_type = 'system' AND system_task_definition_task_type IS NOT NULL AND tenant_task_definition_id IS NULL)
      `, [], 'chk_task_def_type_consistency');
    });
    console.log('Recreated workflow_tasks table.');

    // 2.C. Create workflow_task_history table
    await trx.schema.createTable('workflow_task_history', (table) => {
      table.uuid('history_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('task_id').notNullable();
      table.foreign('task_id').references('task_id').inTable('workflow_tasks').onDelete('CASCADE');
      table.text('tenant').notNullable(); // Changed from tenant_id (UUID) to tenant (TEXT)
      // Example: table.foreign('tenant').references('id_string_column').inTable('tenants').onDelete('CASCADE');
      table.text('action').notNullable();
      table.text('from_status').nullable();
      table.text('to_status').nullable();
      table.uuid('user_id').nullable();
      // Example: table.foreign('user_id').references('user_id').inTable('users');
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.jsonb('details').nullable();
      table.timestamps(true, true); // Adds created_at and updated_at
    });
    console.log('Recreated workflow_task_history table.');

    console.log('Consolidated QBO workflow schema migration (UP) complete.');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    console.log('Starting consolidated QBO workflow schema migration (DOWN)...');

    await trx.raw('DROP TABLE IF EXISTS "workflow_task_history" CASCADE;');
    console.log('Dropped workflow_task_history table (if it existed) with CASCADE.');
    await trx.raw('DROP TABLE IF EXISTS "workflow_tasks" CASCADE;');
    console.log('Dropped workflow_tasks table with CASCADE.');

    await trx.raw('DROP TABLE IF EXISTS "workflow_task_definitions" CASCADE;'); // Tenant-specific
    console.log('Dropped workflow_task_definitions (tenant-specific) table with CASCADE.');

    await trx.raw('DROP TABLE IF EXISTS "system_workflow_task_definitions" CASCADE;');
    console.log('Dropped system_workflow_task_definitions table with CASCADE.');

    await trx.raw('DROP TABLE IF EXISTS "system_workflow_form_definitions" CASCADE;');
    console.log('Dropped system_workflow_form_definitions table with CASCADE.');

    console.log('Consolidated QBO workflow schema migration (DOWN) complete.');
  });
};

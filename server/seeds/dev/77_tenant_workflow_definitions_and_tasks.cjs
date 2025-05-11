/**
 * Seed file for tenant-specific workflow task definitions and workflow tasks.
 * This file demonstrates the new schema for workflow tasks introduced by
 * migration 20250511215231_consolidate_qbo_workflow_schema.cjs.
 */

const { v4: uuidv4 } = require('uuid');

exports.seed = async function(knex) {
  // Get the tenant ID from the tenants table
  const tenantRecord = await knex('tenants').select('tenant').first();
  if (!tenantRecord) {
    console.error('No tenant found in the database. Please run the tenant seed first.');
    return;
  }
  const tenantId = tenantRecord.tenant; // Assuming 'tenant' column holds the UUID

  // Clean up existing data from these tables for this tenant
  // Note: The migration itself drops these tables, so this is mostly for rerunnability if needed.
  await knex('workflow_tasks').where('tenant_id', tenantId).del();
  await knex('workflow_task_definitions').where('tenant_id', tenantId).del();

  // --- 1. Create Tenant-Specific Workflow Task Definitions ---
  const tenantTaskDefinitions = [];

  // Example: Tenant-specific task definition that uses a system form
  const tenantQboMappingErrorHandlerId = uuidv4();
  tenantTaskDefinitions.push({
    task_definition_id: tenantQboMappingErrorHandlerId,
    tenant_id: tenantId,
    name: 'Tenant QBO Mapping Error Handler',
    description: 'Handles QBO mapping errors for this tenant, utilizing a system-defined form.',
    form_id: 'qbo-mapping-error-form', // Name of a form in system_workflow_form_definitions
    form_type: 'system', // Indicates form_id refers to a system form
    default_priority: 'High',
    default_sla_days: 1,
    created_by: null, // Or a specific user UUID if applicable
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (tenantTaskDefinitions.length > 0) {
    await knex('workflow_task_definitions').insert(tenantTaskDefinitions);
    console.log(`Inserted ${tenantTaskDefinitions.length} tenant-specific workflow task definitions for tenant ${tenantId}.`);
  }

  // --- 2. Create Workflow Task Instances ---
  const workflowTasks = [];

  // Example 1: A task instance using a SYSTEM task definition
  // These task types are populated by the migration 20250511215231...
  // e.g., 'qbo_sync_error', 'secret_fetch_error'
  workflowTasks.push({
    task_id: uuidv4(),
    tenant_id: tenantId,
    task_definition_type: 'system', // Indicates this task uses a system definition
    system_task_definition_task_type: 'qbo_sync_error', // FK to system_workflow_task_definitions.task_type
    tenant_task_definition_id: null, // Must be NULL for system tasks
    data: JSON.stringify({
      message: 'System-defined task: A QBO synchronization error occurred.',
      invoice_id: 'INV-SYS-001',
      details: 'Failed to sync with QBO due to API timeout.',
    }),
    status: 'Open',
    priority_override: null,
    assignee_id: null,
    due_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Example 2: A task instance using a TENANT task definition (created above)
  if (tenantTaskDefinitions.length > 0) {
    workflowTasks.push({
      task_id: uuidv4(),
      tenant_id: tenantId,
      task_definition_type: 'tenant', // Indicates this task uses a tenant definition
      system_task_definition_task_type: null, // Must be NULL for tenant tasks
      tenant_task_definition_id: tenantQboMappingErrorHandlerId, // FK to workflow_task_definitions.task_definition_id
      data: JSON.stringify({
        message: 'Tenant-defined task: Resolve QBO item mapping for XYZ.',
        alga_invoice_id: 'ALGA-INV-789',
        entity_id: 'PROD-XYZ',
        current_step: 'investigation',
      }),
      status: 'In Progress',
      priority_override: 1, // Example of overriding default priority
      assignee_id: null, // Could be a user UUID
      due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // Due in 3 days
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  
  // Example 3: Another system task to show variety
  workflowTasks.push({
    task_id: uuidv4(),
    tenant_id: tenantId,
    task_definition_type: 'system',
    system_task_definition_task_type: 'secret_fetch_error', // Another system task type
    tenant_task_definition_id: null,
    data: JSON.stringify({
      message: 'System-defined task: Failed to fetch a required secret.',
      secret_name: 'QBO_API_KEY',
      attempted_at: new Date().toISOString(),
    }),
    status: 'Pending Assignment',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });


  if (workflowTasks.length > 0) {
    await knex('workflow_tasks').insert(workflowTasks);
    console.log(`Inserted ${workflowTasks.length} workflow tasks for tenant ${tenantId}.`);
  }

  console.log('Finished seeding tenant workflow definitions and tasks.');
};
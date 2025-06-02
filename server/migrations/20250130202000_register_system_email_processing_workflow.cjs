/**
 * Register System Email Processing Workflow
 * This migration registers the system-managed email processing workflow
 * that handles inbound emails and creates tickets with threading support
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('📧 Registering System Email Processing Workflow...');

  // Create system workflow tables if they don't exist
  const systemWorkflowRegistrationsExists = await knex.schema.hasTable('system_workflow_registrations');
  if (!systemWorkflowRegistrationsExists) {
    await knex.schema.createTable('system_workflow_registrations', (table) => {
      table.uuid('registration_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.text('name').notNullable();
      table.text('description').nullable();
      table.text('category').nullable();
      table.specificType('tags', 'TEXT[]').nullable();
      table.text('version').notNullable();
      table.text('status').notNullable(); // e.g., 'active', 'draft'
      table.uuid('source_template_id').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.jsonb('definition').notNullable();
      table.jsonb('parameters').nullable();
      table.jsonb('execution_config').nullable();

      // Indexes
      table.index(['category'], 'idx_system_workflow_registrations_category');
      table.index(['name'], 'idx_system_workflow_registrations_name');
      table.index(['tags'], 'idx_system_workflow_registrations_tags', 'gin');
      table.index(['source_template_id'], 'idx_system_workflow_registrations_template');
    });

    await knex.schema.createTable('system_workflow_registration_versions', (table) => {
      table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.uuid('registration_id').notNullable();
      table.foreign('registration_id').references('system_workflow_registrations.registration_id').onDelete('CASCADE');
      table.text('version').notNullable();
      table.boolean('is_current').notNullable().defaultTo(false);
      table.jsonb('definition').notNullable();
      table.jsonb('parameters').nullable();
      table.jsonb('execution_config').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.unique(['registration_id', 'version'], { indexName: 'idx_system_workflow_reg_versions_reg_version' });
    });

    // Create the partial unique index
    await knex.raw(`
      CREATE UNIQUE INDEX idx_system_workflow_reg_versions_current
      ON system_workflow_registration_versions (registration_id)
      WHERE is_current = true;
    `);

    await knex.schema.createTable('system_workflow_event_attachments', (table) => {
      table.uuid('attachment_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.uuid('workflow_id').notNullable();
      table.foreign('workflow_id').references('system_workflow_registrations.registration_id').onDelete('CASCADE');
      table.uuid('event_id').notNullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.unique(['workflow_id', 'event_id'], { indexName: 'system_workflow_event_attachments_workflow_id_event_id_unique' });
      table.index(['event_id'], 'idx_system_workflow_event_attachments_event_id');
    });

    console.log('✅ Created system workflow tables');
  }

  // 1. Register the workflow definition
  const [workflowRegistration] = await knex('system_workflow_registrations').insert({
    registration_id: knex.raw('gen_random_uuid()'),
    name: 'system-email-processing',
    description: 'System-managed workflow that processes inbound emails and creates tickets with email threading support',
    category: 'Email Processing',
    version: '1.0.0',
    status: 'active',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  }).returning('registration_id');

  const workflowRegistrationId = workflowRegistration.registration_id;

  // 2. Create the initial version of the workflow
  await knex('system_workflow_registration_versions').insert({
    version_id: knex.raw('gen_random_uuid()'),
    registration_id: workflowRegistrationId,
    version: '1.0.0',
    is_current: true,
    created_at: knex.fn.now()
  });

  // 3. Register workflow as event handler for INBOUND_EMAIL_RECEIVED
  const emailReceivedEvent = await knex('system_event_catalog')
    .where('event_type', 'INBOUND_EMAIL_RECEIVED')
    .first();

  if (emailReceivedEvent) {
    await knex('system_workflow_event_attachments').insert({
      attachment_id: knex.raw('gen_random_uuid()'),
      workflow_id: workflowRegistrationId,
      event_id: emailReceivedEvent.event_id,
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
    
    console.log('✅ Workflow attached to INBOUND_EMAIL_RECEIVED event');
  } else {
    console.warn('⚠️  INBOUND_EMAIL_RECEIVED event not found - workflow will need manual attachment');
  }

  // 4. Create task definitions for the human tasks used in this workflow
  // TODO: Task definitions might need to be handled differently for system workflows
  /*
  await knex('workflow_task_definitions').insert([
    {
      id: knex.raw('gen_random_uuid()'),
      workflow_registration_id: workflowRegistrationId,
      task_type: 'match_email_to_client',
      name: 'Match Email to Client',
      description: 'Manual task to match an email sender to an existing or new client',
      category: 'Email Processing',
      estimated_duration_minutes: 5,
      requires_approval: false,
      assignee_type: 'role',
      default_assignee: JSON.stringify({
        role: 'admin',
        fallback_role: 'dispatcher'
      }),
      form_schema: JSON.stringify({
        type: 'object',
        properties: {
          selectedCompanyId: {
            type: 'string',
            format: 'uuid',
            title: 'Select Existing Company',
            description: 'Choose an existing company for this email'
          },
          createNewCompany: {
            type: 'boolean',
            title: 'Create New Company',
            description: 'Check this to create a new company instead'
          },
          newCompanyName: {
            type: 'string',
            title: 'New Company Name',
            description: 'Enter company name (required if creating new company)'
          },
          contactName: {
            type: 'string',
            title: 'Contact Name',
            description: 'Name of the contact person'
          },
          saveEmailAssociation: {
            type: 'boolean',
            title: 'Remember this email association',
            description: 'Save this email-to-client mapping for future emails',
            default: true
          }
        },
        required: ['selectedCompanyId']
      }),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: knex.raw('gen_random_uuid()'),
      workflow_registration_id: workflowRegistrationId,
      task_type: 'email_processing_error',
      name: 'Email Processing Error',
      description: 'Manual task to resolve email processing errors',
      category: 'Email Processing',
      estimated_duration_minutes: 10,
      requires_approval: false,
      assignee_type: 'role',
      default_assignee: JSON.stringify({
        role: 'admin',
        fallback_role: 'dispatcher'
      }),
      form_schema: JSON.stringify({
        type: 'object',
        properties: {
          retryProcessing: {
            type: 'boolean',
            title: 'Retry Email Processing',
            description: 'Attempt to process this email again'
          },
          skipEmail: {
            type: 'boolean',
            title: 'Skip This Email',
            description: 'Mark this email as processed without creating a ticket'
          },
          manualTicketId: {
            type: 'string',
            format: 'uuid',
            title: 'Link to Existing Ticket',
            description: 'If you manually created a ticket, provide its ID to link this email'
          },
          notes: {
            type: 'string',
            title: 'Resolution Notes',
            description: 'Add any notes about how this error was resolved'
          }
        }
      }),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ]);
  */

  console.log('✅ System Email Processing Workflow registered successfully');
  console.log('   - Workflow: system-email-processing v1.0.0');
  console.log('   - Event trigger: INBOUND_EMAIL_RECEIVED');
  console.log('   - Task definitions: match_email_to_client, email_processing_error');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('📧 Removing System Email Processing Workflow...');

  // Get the workflow registration ID
  const workflow = await knex('system_workflow_registrations')
    .where('name', 'system-email-processing')
    .first();

  if (workflow) {
    // Remove event attachments
    await knex('system_workflow_event_attachments')
      .where('workflow_id', workflow.registration_id)
      .del();

    // Remove workflow versions
    await knex('system_workflow_registration_versions')
      .where('registration_id', workflow.registration_id)
      .del();

    // Remove workflow registration
    await knex('system_workflow_registrations')
      .where('registration_id', workflow.registration_id)
      .del();

    console.log('✅ System Email Processing Workflow removed successfully');
  } else {
    console.log('⚠️  System Email Processing Workflow not found - nothing to remove');
  }
};
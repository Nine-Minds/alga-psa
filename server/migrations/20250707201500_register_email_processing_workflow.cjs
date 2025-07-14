// server/migrations/20250707201500_register_email_processing_workflow.cjs
const { v4: uuidv4 } = require('uuid');

// Define the specific registration ID for the Email Processing workflow
const EMAIL_PROCESSING_WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440001'; // Static UUID for this system workflow

// Email Processing Workflow Definition
const emailProcessingWorkflowDefinition = {
  metadata: {
    name: 'System Email Processing',
    description: 'Processes inbound emails and creates tickets with email threading support',
    version: '1.0.0',
    author: 'System',
    tags: ['email', 'ticket', 'system'],
  },
  executeFn: `
    async function execute(context) {
      // This is a placeholder - the actual execution happens in
      // @shared/workflow/workflows/system-email-processing-workflow.ts
      const { systemEmailProcessingWorkflow } = await import('@shared/workflow/workflows/system-email-processing-workflow.js');
      return await systemEmailProcessingWorkflow(context);
    }
  `,
};

exports.up = async function(knex) {
  console.log('Registering System Email Processing Workflow...');

  // Check if the registration already exists
  const existingReg = await knex('system_workflow_registrations')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .first();

  if (!existingReg) {
    // Insert System Workflow Registration
    await knex('system_workflow_registrations').insert([
      {
        registration_id: EMAIL_PROCESSING_WORKFLOW_ID,
        name: emailProcessingWorkflowDefinition.metadata.name,
        description: emailProcessingWorkflowDefinition.metadata.description,
        category: 'system',
        tags: emailProcessingWorkflowDefinition.metadata.tags,
        version: emailProcessingWorkflowDefinition.metadata.version,
        status: 'active',
        created_by: null, // System user
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Insert System Workflow Version
    await knex('system_workflow_registration_versions').insert([
      {
        version_id: uuidv4(),
        registration_id: EMAIL_PROCESSING_WORKFLOW_ID,
        version: emailProcessingWorkflowDefinition.metadata.version,
        is_current: true,
        code: emailProcessingWorkflowDefinition.executeFn,
        created_by: null,
        created_at: new Date().toISOString(),
      },
    ]);

    console.log('✅ Inserted System Email Processing Workflow registration.');
  } else {
    console.log('ℹ️ System Email Processing Workflow already exists, skipping registration.');
  }

  // Get the INBOUND_EMAIL_RECEIVED event ID from system catalog
  const inboundEmailEvent = await knex('system_event_catalog')
    .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
    .first();

  if (!inboundEmailEvent) {
    throw new Error('INBOUND_EMAIL_RECEIVED event not found in system_event_catalog');
  }

  // Check if INBOUND_EMAIL_RECEIVED event attachment already exists
  const existingAttachment = await knex('system_workflow_event_attachments')
    .where({ 
      workflow_id: EMAIL_PROCESSING_WORKFLOW_ID,
      event_id: inboundEmailEvent.event_id
    })
    .first();

  if (!existingAttachment) {
    // Create event attachment for INBOUND_EMAIL_RECEIVED events in system table
    await knex('system_workflow_event_attachments').insert([
      {
        attachment_id: uuidv4(),
        workflow_id: EMAIL_PROCESSING_WORKFLOW_ID,
        event_id: inboundEmailEvent.event_id,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    console.log('✅ Created INBOUND_EMAIL_RECEIVED event attachment for Email Processing Workflow.');
  } else {
    console.log('ℹ️ INBOUND_EMAIL_RECEIVED event attachment already exists.');
  }
};

exports.down = async function(knex) {
  console.log('Removing System Email Processing Workflow...');

  // Remove event attachments first (to avoid foreign key issues)
  const deletedAttachments = await knex('system_workflow_event_attachments')
    .where({ 
      workflow_id: EMAIL_PROCESSING_WORKFLOW_ID
    })
    .del();

  // Remove workflow version
  const deletedVersions = await knex('system_workflow_registration_versions')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .del();

  // Remove workflow registration
  const deletedRegistrations = await knex('system_workflow_registrations')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .del();

  console.log(`🗑️ Removed Email Processing Workflow: ${deletedRegistrations} registrations, ${deletedVersions} versions, ${deletedAttachments} attachments.`);
};
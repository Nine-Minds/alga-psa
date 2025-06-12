const { v4: uuidv4 } = require('uuid');

// Define the specific registration ID for the QBO import workflow
const QBO_IMPORT_REGISTRATION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// QBO Customer Import Workflow Definition
const qboCustomerImportWorkflowDefinition = {
  metadata: {
    name: 'QBO Customer Import',
    description: 'Imports customers from QuickBooks Online into Alga PSA (Companies and Contacts).',
    version: '1.0.0',
    author: 'System',
    tags: ['qbo', 'import', 'customer', 'company', 'contact'],
  },
  executeFn: 'qboCustomerImportWorkflow', // Reference to the actual workflow function
  code: `
// Workflow implementation is in server/src/lib/workflows/qboCustomerImportWorkflow.ts
// This is registered as a system workflow that handles the IMPORT_JOB_REQUESTED event
export { qboCustomerImportWorkflow } from '@server/lib/workflows/qboCustomerImportWorkflow';
  `
};

exports.up = async function(knex) {
  // Check if the registration already exists
  const existingReg = await knex('system_workflow_registrations')
    .where({ registration_id: QBO_IMPORT_REGISTRATION_ID })
    .first();

  if (!existingReg) {
    // Insert System Workflow Registration
    await knex('system_workflow_registrations').insert([
      {
        registration_id: QBO_IMPORT_REGISTRATION_ID,
        name: qboCustomerImportWorkflowDefinition.metadata.name,
        description: qboCustomerImportWorkflowDefinition.metadata.description,
        category: 'import',
        tags: qboCustomerImportWorkflowDefinition.metadata.tags,
        version: qboCustomerImportWorkflowDefinition.metadata.version,
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
        registration_id: QBO_IMPORT_REGISTRATION_ID,
        version: qboCustomerImportWorkflowDefinition.metadata.version,
        is_current: true,
        code: qboCustomerImportWorkflowDefinition.code,
        created_by: null, // System user
        created_at: new Date().toISOString(),
      },
    ]);

    // Create event attachment for IMPORT_JOB_REQUESTED trigger
    // First check if the table exists
    const hasAttachmentsTable = await knex.schema.hasTable('system_workflow_event_attachments');
    if (hasAttachmentsTable) {
      // Get the IMPORT_JOB_REQUESTED event ID
      const importJobRequestedEvent = await knex('system_event_catalog')
        .where({ event_type: 'IMPORT_JOB_REQUESTED' })
        .first();

      if (importJobRequestedEvent) {
        await knex('system_workflow_event_attachments').insert([
          {
            attachment_id: uuidv4(),
            workflow_id: QBO_IMPORT_REGISTRATION_ID,
            event_id: importJobRequestedEvent.event_id,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }
    }

    console.log('✅ Registered QBO Customer Import workflow');
  } else {
    console.log('QBO Customer Import workflow already exists, skipping registration');
  }
};

exports.down = async function(knex) {
  // Remove event attachments
  const hasAttachmentsTable = await knex.schema.hasTable('system_workflow_event_attachments');
  if (hasAttachmentsTable) {
    await knex('system_workflow_event_attachments')
      .where({ workflow_id: QBO_IMPORT_REGISTRATION_ID })
      .del();
  }
  
  // Remove workflow versions
  await knex('system_workflow_registration_versions')
    .where({ registration_id: QBO_IMPORT_REGISTRATION_ID })
    .del();
    
  // Remove workflow registration
  await knex('system_workflow_registrations')
    .where({ registration_id: QBO_IMPORT_REGISTRATION_ID })
    .del();
    
  console.log('Removed QBO Customer Import workflow registration');
};
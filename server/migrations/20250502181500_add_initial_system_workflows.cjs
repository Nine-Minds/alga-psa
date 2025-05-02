// server/migrations/20250502181500_add_initial_system_workflows.cjs
const { v4: uuidv4 } = require('uuid'); // Use require for uuid

// Define the specific registration ID for the QBO workflow
const QBO_REGISTRATION_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef'; // Static UUID for this system workflow

// Placeholder QBO Workflow Definition (same as in the seed)
const qboSyncWorkflowDefinition = {
  metadata: {
    name: 'QBO Customer Sync',
    description: 'Syncs customer data with QuickBooks Online.',
    version: '1.0.0',
    author: 'System',
    tags: ['qbo', 'sync', 'customer'],
  },
  executeFn: `
    async function execute(context) {
      console.log('Executing QBO Customer Sync workflow...');
      const customerData = context.eventPayload?.customer;
      if (!customerData) {
        console.warn('No customer data found in event payload.');
        return { success: false, message: 'Missing customer data.' };
      }
      console.log('Syncing customer:', customerData.id);
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('QBO Customer Sync completed for:', customerData.id);
      return { success: true, message: 'Customer synced successfully.' };
    }
  `,
};

exports.up = async function(knex) { // Changed to exports.up, removed types
  // Check if the registration already exists
  const existingReg = await knex('system_workflow_registrations')
    .where({ registration_id: QBO_REGISTRATION_ID })
    .first();

  if (!existingReg) {
    // Insert System Workflow Registration
    await knex('system_workflow_registrations').insert([
      {
        registration_id: QBO_REGISTRATION_ID,
        name: qboSyncWorkflowDefinition.metadata.name,
        description: qboSyncWorkflowDefinition.metadata.description,
        category: 'system',
        tags: qboSyncWorkflowDefinition.metadata.tags, // Pass array directly for TEXT[] column
        version: qboSyncWorkflowDefinition.metadata.version,
        status: 'active',
        definition: JSON.stringify(qboSyncWorkflowDefinition), // Keep stringify for object
        created_by: null, // Use null for system user
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Insert System Workflow Version
    await knex('system_workflow_registration_versions').insert([
      {
        version_id: uuidv4(), // Version ID can be dynamic
        registration_id: QBO_REGISTRATION_ID,
        version: qboSyncWorkflowDefinition.metadata.version,
        is_current: true,
        definition: JSON.stringify(qboSyncWorkflowDefinition), // Keep stringify for object
        created_by: null, // Use null for system user
        created_at: new Date().toISOString(),
        // updated_at is handled by trigger in the schema migration
      },
    ]);
    console.log('Inserted initial QBO system workflow via migration.');
  } else {
    console.log('QBO system workflow already exists, skipping insertion in migration.');
  }
};

exports.down = async function(knex) { // Changed to exports.down, removed types
  // Remove the specific system workflow added by this migration
  // Also remove any potential attachments to avoid foreign key issues if attachments were added elsewhere
  await knex('system_workflow_event_attachments')
      .where({ workflow_id: QBO_REGISTRATION_ID })
      .del();
  await knex('system_workflow_registration_versions')
    .where({ registration_id: QBO_REGISTRATION_ID })
    .del();
  await knex('system_workflow_registrations')
    .where({ registration_id: QBO_REGISTRATION_ID })
    .del();
  console.log('Removed QBO system workflow via migration rollback.');
};
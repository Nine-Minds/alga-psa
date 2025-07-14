const { v4: uuidv4 } = require('uuid');

// Use the same static UUID as defined in the migration
const QBO_REGISTRATION_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

// Placeholder QBO Workflow Definition
const qboSyncWorkflowDefinition = {
  metadata: {
    name: 'QBO Customer Sync',
    description: 'Syncs customer data with QuickBooks Online.',
    version: '1.0.0',
    author: 'System',
    tags: ['qbo', 'sync', 'customer'],
  },
  // Placeholder executeFn - replace with actual logic if available
  executeFn: `
    async function execute(context) {
      console.log('Executing QBO Customer Sync workflow...');
      // TODO: Implement actual QBO sync logic
      const customerData = context.eventPayload?.customer;
      if (!customerData) {
        console.warn('No customer data found in event payload.');
        return { success: false, message: 'Missing customer data.' };
      }
      console.log('Syncing customer:', customerData.id);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('QBO Customer Sync completed for:', customerData.id);
      return { success: true, message: 'Customer synced successfully.' };
    }
  `,
};

exports.seed = async function (knex) {
  // Check if the QBO system workflow already exists (added by migration or previous seed run)
  const existingReg = await knex('system_workflow_registrations')
    .where({ registration_id: QBO_REGISTRATION_ID })
    .first();

  if (!existingReg) {
    console.log('QBO system workflow not found, inserting via seed...');
    // Insert System Workflow Registration
    await knex('system_workflow_registrations').insert([
      {
        registration_id: QBO_REGISTRATION_ID, // Use static ID
        name: qboSyncWorkflowDefinition.metadata.name,
        description: qboSyncWorkflowDefinition.metadata.description,
      category: 'system', // Mark as system category
      tags: JSON.stringify(qboSyncWorkflowDefinition.metadata.tags), // Store tags as JSON string
      version: qboSyncWorkflowDefinition.metadata.version,
      status: 'active', // Default to active
      definition: JSON.stringify(qboSyncWorkflowDefinition), // Store full definition as JSON string
      created_by: 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    ]);

    // Insert System Workflow Version
    await knex('system_workflow_registration_versions').insert([
      {
        version_id: uuidv4(), // Version ID can be dynamic
        registration_id: QBO_REGISTRATION_ID, // Use static ID
        version: qboSyncWorkflowDefinition.metadata.version,
        is_current: true,
        code: qboSyncWorkflowDefinition.executeFn, // Store executeFn string in 'code'
        created_by: 'system',
      created_at: new Date().toISOString(),
      },
    ]);
    console.log('System workflow seed data inserted.');
  } else {
    console.log('QBO system workflow already exists, skipping seed insertion.');
  }

  // Optionally, insert system workflow event attachments if needed
  // Example: Attach the QBO sync workflow to a specific system event
  /*
  const qboEventId = 'SYSTEM_EVENT_QBO_CUSTOMER_UPDATE'; // Replace with actual system event ID if known
  await knex('system_workflow_event_attachments').insert([
      {
          attachment_id: uuidv4(),
          workflow_id: QBO_REGISTRATION_ID, // Use static ID
          event_id: qboEventId,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      }
  ]);
  */

};
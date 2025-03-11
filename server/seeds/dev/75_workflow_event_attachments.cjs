/**
 * Seed file for workflow event attachments
 * This creates event attachments for the InvoiceApproval workflow
 */

const { v4: uuidv4 } = require('uuid');

exports.seed = async function(knex) {
  // Get the tenant ID from the tenants table
  const tenantRecord = await knex('tenants').select('tenant').first();
  if (!tenantRecord) {
    console.error('No tenant found in the database. Please run the tenant seed first.');
    return;
  }
  
  // Use the tenant ID from the database
  const tenant = tenantRecord.tenant;
  
  // Get the InvoiceApproval workflow registration
  const registration = await knex('workflow_registrations')
    .where('tenant_id', tenant)
    .where('name', 'InvoiceApproval')
    .first();
    
  if (!registration) {
    console.error('InvoiceApproval workflow registration not found. Please run the workflow_registrations seed first.');
    return;
  }
  
  // Check if event attachments already exist for this workflow
  const existingAttachments = await knex('workflow_event_attachments')
    .where('tenant_id', tenant)
    .where('workflow_id', registration.registration_id)
    .count('attachment_id as count')
    .first();
    
  if (existingAttachments.count > 0) {
    console.log('Event attachments for InvoiceApproval workflow already exist, skipping seed');
    return;
  }
  
  // Get the event IDs from the event_catalog table
  const eventNames = ['Submit', 'Approve', 'Reject', 'Pay'];
  const events = await knex('event_catalog')
    .select('event_id', 'event_type')
    .whereIn('event_type', eventNames)
    .where('tenant_id', tenant);
    
  if (events.length === 0) {
    console.error('No events found in the event catalog. Please run the event catalog seed first.');
    return;
  }
  
  console.log(`Found ${events.length} events in the event catalog`);
  
  // Create event attachments
  const attachments = [];
  
  for (const event of events) {
    attachments.push({
      attachment_id: uuidv4(),
      tenant_id: tenant,
      workflow_id: registration.registration_id,
      event_id: event.event_id,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  
  // Insert the event attachments
  await knex('workflow_event_attachments').insert(attachments);
  
  console.log(`Created ${attachments.length} event attachments for InvoiceApproval workflow`);
};
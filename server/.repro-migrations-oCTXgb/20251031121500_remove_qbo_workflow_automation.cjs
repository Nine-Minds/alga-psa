'use strict';

const LEGACY_EVENT_TYPES = ['INVOICE_CREATED', 'INVOICE_UPDATED', 'CLIENT_CREATED', 'CLIENT_UPDATED'];
const LEGACY_WORKFLOW_NAMES = ['QBO Customer Sync', 'qboInvoiceSyncWorkflow', 'qboCustomerSyncWorkflow'];

exports.up = async function up(knex) {
  // Citus needs sequential multi-shard modifications when mixing reference/distributed tables.
  const { rows: citusExtension } = await knex.raw("SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'citus' LIMIT 1");
  if (citusExtension.length > 0) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }

  // Remove tenant-scoped workflow attachments tied to legacy QBO events
  await knex('workflow_event_attachments')
    .whereIn('event_type', LEGACY_EVENT_TYPES)
    .del();

  // Remove system workflow attachments tied to the same legacy events
  const systemAttachmentIds = await knex('system_workflow_event_attachments')
    .select('system_workflow_event_attachments.attachment_id')
    .join('event_catalog', 'system_workflow_event_attachments.event_id', 'event_catalog.event_id')
    .whereIn('event_catalog.event_type', LEGACY_EVENT_TYPES);

  if (systemAttachmentIds.length > 0) {
    await knex('system_workflow_event_attachments')
      .whereIn(
        'attachment_id',
        systemAttachmentIds.map((row) => row.attachment_id)
      )
      .del();
  }

  // Remove system workflow registrations for legacy QBO workflows
  const legacySystemWorkflows = await knex('system_workflow_registrations')
    .whereIn('name', LEGACY_WORKFLOW_NAMES)
    .select('registration_id');

  if (legacySystemWorkflows.length > 0) {
    const registrationIds = legacySystemWorkflows.map((row) => row.registration_id);

    await knex('system_workflow_event_attachments').whereIn('workflow_id', registrationIds).del();
    await knex('system_workflow_registration_versions').whereIn('registration_id', registrationIds).del();
    await knex('system_workflow_registrations').whereIn('registration_id', registrationIds).del();
  }

  // Remove any tenant workflow registrations that still reference the legacy names
  const legacyTenantWorkflows = await knex('workflow_registrations')
    .whereIn('name', LEGACY_WORKFLOW_NAMES)
    .select('registration_id');

  if (legacyTenantWorkflows.length > 0) {
    const tenantRegistrationIds = legacyTenantWorkflows.map((row) => row.registration_id);

    await knex('workflow_event_attachments').whereIn('workflow_id', tenantRegistrationIds).del();
    await knex('workflow_registration_versions').whereIn('registration_id', tenantRegistrationIds).del();
    await knex('workflow_registrations').whereIn('registration_id', tenantRegistrationIds).del();
  }
};

exports.down = async function down() {
  // Removing legacy workflow integrations is not reversible.
  console.warn('Skipping down migration for remove_qbo_workflow_automation.');
};

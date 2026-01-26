'use strict';

/**
 * Upserts expanded Workflow Event Catalog v2 domain events into system_event_catalog.
 *
 * This migration is intentionally idempotent:
 * - Inserts missing rows by event_type
 * - Updates name/description/category/payload_schema_ref for existing rows
 *
 * Note: We do not attempt to manage legacy JSON payload_schema here; the workflow runtime
 * uses payload_schema_ref + schema registry for validation/simulation.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  // Use a literal timestamp instead of CURRENT_TIMESTAMP function
  // Citus requires IMMUTABLE functions in ON CONFLICT DO UPDATE SET clauses
  const now = new Date().toISOString();

  // Remove deprecated COMPANY_* events (company has been renamed to client)
  await knex('system_event_catalog')
    .whereIn('event_type', ['COMPANY_CREATED', 'COMPANY_UPDATED'])
    .del();

  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) {
    await knex.schema.alterTable('system_event_catalog', (t) => {
      t.text('payload_schema_ref').nullable();
      t.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
    });
  }

  const baseEvents = [
    { event_type: 'TICKET_CREATED', name: 'Ticket Created', description: 'Triggered when a new ticket is created.', category: 'Tickets' },
    { event_type: 'TICKET_UPDATED', name: 'Ticket Updated', description: 'Triggered when a ticket is updated.', category: 'Tickets' },
    { event_type: 'TICKET_CLOSED', name: 'Ticket Closed', description: 'Triggered when a ticket is closed.', category: 'Tickets' },
    {
      event_type: 'TICKET_RESPONSE_STATE_CHANGED',
      name: 'Ticket Response State Changed',
      description: 'Triggered when a ticket response state changes.',
      category: 'Tickets',
    },
    { event_type: 'PROJECT_CREATED', name: 'Project Created', description: 'Triggered when a new project is created.', category: 'Projects' },
    { event_type: 'INVOICE_GENERATED', name: 'Invoice Generated', description: 'Triggered when an invoice is generated.', category: 'Billing' },
    { event_type: 'INVOICE_FINALIZED', name: 'Invoice Finalized', description: 'Triggered when an invoice is finalized.', category: 'Billing' },
    {
      event_type: 'INBOUND_EMAIL_RECEIVED',
      name: 'Inbound Email Received',
      description: 'Triggered when an inbound email is received from a configured provider.',
      category: 'Email Processing',
    },
    {
      event_type: 'EMAIL_PROVIDER_CONNECTED',
      name: 'Email Provider Connected',
      description: 'Triggered when an email provider is successfully connected and configured.',
      category: 'Email Processing',
    },
    {
      event_type: 'EMAIL_PROVIDER_DISCONNECTED',
      name: 'Email Provider Disconnected',
      description: 'Triggered when an email provider is disconnected or deactivated.',
      category: 'Email Processing',
    },
  ];

  const proposedEvents = [
    { event_type: 'APPOINTMENT_ASSIGNED', name: 'Appointment Assigned', description: 'Assigned/reassigned to an agent/team.', category: 'Scheduling' },
    { event_type: 'APPOINTMENT_CANCELED', name: 'Appointment Canceled', description: 'Appointment canceled.', category: 'Scheduling' },
    { event_type: 'APPOINTMENT_COMPLETED', name: 'Appointment Completed', description: 'Marked completed.', category: 'Scheduling' },
    { event_type: 'APPOINTMENT_CREATED', name: 'Appointment Created', description: 'Appointment scheduled (often tied to a ticket).', category: 'Scheduling' },
    { event_type: 'APPOINTMENT_NO_SHOW', name: 'Appointment No-Show', description: 'No-show recorded.', category: 'Scheduling' },
    { event_type: 'APPOINTMENT_RESCHEDULED', name: 'Appointment Rescheduled', description: 'Time changed.', category: 'Scheduling' },
    { event_type: 'ASSET_ASSIGNED', name: 'Asset Assigned', description: 'Asset assigned to client/contact/site.', category: 'Assets' },
    { event_type: 'ASSET_CREATED', name: 'Asset Created', description: 'Asset record created.', category: 'Assets' },
    { event_type: 'ASSET_UNASSIGNED', name: 'Asset Unassigned', description: 'Asset unassigned.', category: 'Assets' },
    { event_type: 'ASSET_UPDATED', name: 'Asset Updated', description: 'Asset fields changed.', category: 'Assets' },
    { event_type: 'ASSET_WARRANTY_EXPIRING', name: 'Asset Warranty Expiring', description: 'Warranty approaching expiration.', category: 'Assets' },
    { event_type: 'CAPACITY_THRESHOLD_REACHED', name: 'Capacity Threshold Reached', description: 'Team/day capacity threshold hit.', category: 'Scheduling' },
    { event_type: 'CLIENT_ARCHIVED', name: 'Client Archived', description: 'Client archived/deactivated.', category: 'CRM' },
    { event_type: 'CLIENT_CREATED', name: 'Client Created', description: 'Client/account created.', category: 'CRM' },
    { event_type: 'CLIENT_MERGED', name: 'Client Merged', description: 'Client merged into another.', category: 'CRM' },
    { event_type: 'CLIENT_OWNER_ASSIGNED', name: 'Client Owner Assigned', description: 'Account manager assigned/reassigned.', category: 'CRM' },
    { event_type: 'CLIENT_STATUS_CHANGED', name: 'Client Status Changed', description: 'Lifecycle status transition (prospect→active, etc).', category: 'CRM' },
    { event_type: 'CLIENT_UPDATED', name: 'Client Updated', description: 'Client fields changed.', category: 'CRM' },
    { event_type: 'CONTACT_ARCHIVED', name: 'Contact Archived', description: 'Contact deactivated/archived.', category: 'CRM' },
    { event_type: 'CONTACT_CREATED', name: 'Contact Created', description: 'Contact added to client.', category: 'CRM' },
    { event_type: 'CONTACT_MERGED', name: 'Contact Merged', description: 'Contact merged into another.', category: 'CRM' },
    { event_type: 'CONTACT_PRIMARY_SET', name: 'Primary Contact Set', description: 'Contact set as client primary/billing.', category: 'CRM' },
    { event_type: 'CONTACT_UPDATED', name: 'Contact Updated', description: 'Contact fields changed.', category: 'CRM' },
    { event_type: 'CONTRACT_CREATED', name: 'Contract Created', description: 'Client contract created.', category: 'Billing' },
    { event_type: 'CONTRACT_RENEWAL_UPCOMING', name: 'Contract Renewal Upcoming', description: 'Renewal is approaching.', category: 'Billing' },
    { event_type: 'CONTRACT_STATUS_CHANGED', name: 'Contract Status Changed', description: 'Contract lifecycle change.', category: 'Billing' },
    { event_type: 'CONTRACT_UPDATED', name: 'Contract Updated', description: 'Contract fields changed.', category: 'Billing' },
    { event_type: 'CREDIT_NOTE_APPLIED', name: 'Credit Note Applied', description: 'Credit applied to invoice.', category: 'Billing' },
    { event_type: 'CREDIT_NOTE_CREATED', name: 'Credit Note Created', description: 'Credit issued.', category: 'Billing' },
    { event_type: 'CREDIT_NOTE_VOIDED', name: 'Credit Note Voided', description: 'Credit voided.', category: 'Billing' },
    { event_type: 'CSAT_ALERT_TRIGGERED', name: 'CSAT Alert Triggered', description: 'CSAT dropped / low score alert.', category: 'Surveys' },
    { event_type: 'DOCUMENT_ASSOCIATED', name: 'Document Associated', description: 'Document associated to an entity.', category: 'Documents' },
    { event_type: 'DOCUMENT_DELETED', name: 'Document Deleted', description: 'Document removed.', category: 'Documents' },
    { event_type: 'DOCUMENT_DETACHED', name: 'Document Detached', description: 'Document association removed.', category: 'Documents' },
    { event_type: 'DOCUMENT_GENERATED', name: 'Document Generated', description: 'System-generated document created (invoice/PDF/etc).', category: 'Documents' },
    { event_type: 'DOCUMENT_SIGNATURE_EXPIRED', name: 'Document Signature Expired', description: 'Signature request expired.', category: 'Documents' },
    { event_type: 'DOCUMENT_SIGNATURE_REQUESTED', name: 'Document Signature Requested', description: 'Signature requested.', category: 'Documents' },
    { event_type: 'DOCUMENT_SIGNED', name: 'Document Signed', description: 'Document fully signed.', category: 'Documents' },
    { event_type: 'DOCUMENT_UPLOADED', name: 'Document Uploaded', description: 'Document uploaded into storage.', category: 'Documents' },
    { event_type: 'EMAIL_BOUNCED', name: 'Email Bounced', description: 'Provider reported bounce.', category: 'Email Processing' },
    { event_type: 'EMAIL_COMPLAINT_RECEIVED', name: 'Email Complaint Received', description: 'Recipient complaint/spam report.', category: 'Email Processing' },
    { event_type: 'EMAIL_DELIVERED', name: 'Email Delivered', description: 'Provider confirmed delivery.', category: 'Email Processing' },
    { event_type: 'EMAIL_UNSUBSCRIBED', name: 'Email Unsubscribed', description: 'Recipient unsubscribed.', category: 'Email Processing' },
    {
      event_type: 'EXTERNAL_MAPPING_CHANGED',
      name: 'External Mapping Changed',
      description: 'External mapping updated (accounts/tax/service catalog).',
      category: 'Integrations',
    },
    { event_type: 'FILE_UPLOADED', name: 'File Uploaded', description: 'File uploaded to media pipeline.', category: 'Media' },
    {
      event_type: 'INBOUND_EMAIL_REPLY_RECEIVED',
      name: 'Inbound Email Reply Received',
      description: 'Inbound email identified as reply to existing thread/ticket.',
      category: 'Email Processing',
    },
    { event_type: 'INTEGRATION_CONNECTED', name: 'Integration Connected', description: 'Connection established.', category: 'Integrations' },
    { event_type: 'INTEGRATION_DISCONNECTED', name: 'Integration Disconnected', description: 'Connection removed/invalidated.', category: 'Integrations' },
    { event_type: 'INTEGRATION_SYNC_COMPLETED', name: 'Integration Sync Completed', description: 'Sync finishes successfully.', category: 'Integrations' },
    { event_type: 'INTEGRATION_SYNC_FAILED', name: 'Integration Sync Failed', description: 'Sync fails.', category: 'Integrations' },
    { event_type: 'INTEGRATION_SYNC_STARTED', name: 'Integration Sync Started', description: 'Sync job begins.', category: 'Integrations' },
    { event_type: 'INTEGRATION_TOKEN_EXPIRING', name: 'Integration Token Expiring', description: 'OAuth token nearing expiration.', category: 'Integrations' },
    { event_type: 'INTEGRATION_TOKEN_REFRESH_FAILED', name: 'Integration Token Refresh Failed', description: 'Refresh failed.', category: 'Integrations' },
    { event_type: 'INTEGRATION_WEBHOOK_RECEIVED', name: 'Integration Webhook Received', description: 'Webhook received.', category: 'Integrations' },
    { event_type: 'INTERACTION_LOGGED', name: 'Interaction Logged', description: 'CRM interaction recorded.', category: 'CRM' },
    { event_type: 'INVOICE_DUE_DATE_CHANGED', name: 'Invoice Due Date Changed', description: 'Due date updated.', category: 'Billing' },
    { event_type: 'INVOICE_OVERDUE', name: 'Invoice Overdue', description: 'Invoice became overdue.', category: 'Billing' },
    { event_type: 'INVOICE_SENT', name: 'Invoice Sent', description: 'Invoice delivered to customer.', category: 'Billing' },
    { event_type: 'INVOICE_STATUS_CHANGED', name: 'Invoice Status Changed', description: 'Status transition (draft→sent→paid, etc).', category: 'Billing' },
    { event_type: 'INVOICE_WRITTEN_OFF', name: 'Invoice Written Off', description: 'Invoice written off.', category: 'Billing' },
    { event_type: 'MEDIA_PROCESSING_FAILED', name: 'Media Processing Failed', description: 'Processing failed.', category: 'Media' },
    { event_type: 'MEDIA_PROCESSING_SUCCEEDED', name: 'Media Processing Succeeded', description: 'Processing complete (thumbnails/virus scan).', category: 'Media' },
    { event_type: 'NOTE_CREATED', name: 'Note Created', description: 'Note attached to client/contact.', category: 'CRM' },
    { event_type: 'NOTIFICATION_DELIVERED', name: 'Notification Delivered', description: 'Provider confirmed delivery.', category: 'Notifications' },
    { event_type: 'NOTIFICATION_FAILED', name: 'Notification Failed', description: 'Delivery failed.', category: 'Notifications' },
    {
      event_type: 'NOTIFICATION_READ',
      name: 'Notification Read',
      description: 'Recipient opened/read notification (trackable channels only).',
      category: 'Notifications',
    },
    { event_type: 'NOTIFICATION_SENT', name: 'Notification Sent', description: 'Notification queued/sent.', category: 'Notifications' },
    { event_type: 'OUTBOUND_EMAIL_FAILED', name: 'Outbound Email Failed', description: 'Provider rejected/failed outbound email.', category: 'Email Processing' },
    {
      event_type: 'OUTBOUND_EMAIL_QUEUED',
      name: 'Outbound Email Queued',
      description: 'Outbound email queued for sending.',
      category: 'Email Processing',
    },
    { event_type: 'OUTBOUND_EMAIL_SENT', name: 'Outbound Email Sent', description: 'Provider accepted outbound email.', category: 'Email Processing' },
    { event_type: 'PAYMENT_APPLIED', name: 'Payment Applied', description: 'Payment applied to invoices.', category: 'Billing' },
    { event_type: 'PAYMENT_FAILED', name: 'Payment Failed', description: 'Payment attempt failed.', category: 'Billing' },
    { event_type: 'PAYMENT_RECORDED', name: 'Payment Recorded', description: 'Payment created/recorded.', category: 'Billing' },
    { event_type: 'PAYMENT_REFUNDED', name: 'Payment Refunded', description: 'Refund issued.', category: 'Billing' },
    { event_type: 'PROJECT_APPROVAL_GRANTED', name: 'Project Approval Granted', description: 'Approval granted.', category: 'Projects' },
    { event_type: 'PROJECT_APPROVAL_REJECTED', name: 'Project Approval Rejected', description: 'Approval rejected.', category: 'Projects' },
    {
      event_type: 'PROJECT_APPROVAL_REQUESTED',
      name: 'Project Approval Requested',
      description: 'Scope/budget/change approval request.',
      category: 'Projects',
    },
    { event_type: 'PROJECT_STATUS_CHANGED', name: 'Project Status Changed', description: 'Project status transition.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_ASSIGNED', name: 'Project Task Assigned', description: 'Task assigned to user/team.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_COMPLETED', name: 'Project Task Completed', description: 'Task completed.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_CREATED', name: 'Project Task Created', description: 'Task added.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_DEPENDENCY_BLOCKED', name: 'Project Task Blocked', description: 'Dependency blocks progress.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_DEPENDENCY_UNBLOCKED', name: 'Project Task Unblocked', description: 'Dependency resolved.', category: 'Projects' },
    { event_type: 'PROJECT_TASK_STATUS_CHANGED', name: 'Project Task Status Changed', description: 'Task status transition.', category: 'Projects' },
    { event_type: 'PROJECT_UPDATED', name: 'Project Updated', description: 'Project fields changed.', category: 'Projects' },
    { event_type: 'RECURRING_BILLING_RUN_COMPLETED', name: 'Recurring Billing Run Completed', description: 'Run completes.', category: 'Billing' },
    { event_type: 'RECURRING_BILLING_RUN_FAILED', name: 'Recurring Billing Run Failed', description: 'Run fails.', category: 'Billing' },
    { event_type: 'RECURRING_BILLING_RUN_STARTED', name: 'Recurring Billing Run Started', description: 'Run begins.', category: 'Billing' },
    { event_type: 'SCHEDULE_BLOCK_CREATED', name: 'Schedule Block Created', description: 'Availability block created.', category: 'Scheduling' },
    { event_type: 'SCHEDULE_BLOCK_DELETED', name: 'Schedule Block Deleted', description: 'Availability block removed.', category: 'Scheduling' },
    { event_type: 'SURVEY_EXPIRED', name: 'Survey Expired', description: 'Survey expired without response.', category: 'Surveys' },
    { event_type: 'SURVEY_REMINDER_SENT', name: 'Survey Reminder Sent', description: 'Reminder sent.', category: 'Surveys' },
    { event_type: 'SURVEY_RESPONSE_RECEIVED', name: 'Survey Response Received', description: 'Survey response recorded.', category: 'Surveys' },
    { event_type: 'SURVEY_SENT', name: 'Survey Sent', description: 'Survey/CSAT request sent.', category: 'Surveys' },
    { event_type: 'TAG_APPLIED', name: 'Tag Applied', description: 'Tag applied to entity.', category: 'Tags' },
    { event_type: 'TAG_DEFINITION_CREATED', name: 'Tag Definition Created', description: 'New tag created.', category: 'Tags' },
    { event_type: 'TAG_DEFINITION_UPDATED', name: 'Tag Definition Updated', description: 'Tag definition changed.', category: 'Tags' },
    { event_type: 'TAG_REMOVED', name: 'Tag Removed', description: 'Tag removed from entity.', category: 'Tags' },
    { event_type: 'TECHNICIAN_ARRIVED', name: 'Technician Arrived', description: 'Arrival recorded.', category: 'Scheduling' },
    { event_type: 'TECHNICIAN_CHECKED_OUT', name: 'Technician Checked Out', description: 'Completed onsite work.', category: 'Scheduling' },
    { event_type: 'TECHNICIAN_DISPATCHED', name: 'Technician Dispatched', description: 'Dispatch action taken.', category: 'Scheduling' },
    { event_type: 'TECHNICIAN_EN_ROUTE', name: 'Technician En Route', description: 'En route status update.', category: 'Scheduling' },
    { event_type: 'TICKET_APPROVAL_GRANTED', name: 'Ticket Approval Granted', description: 'Approval granted.', category: 'Tickets' },
    { event_type: 'TICKET_APPROVAL_REJECTED', name: 'Ticket Approval Rejected', description: 'Approval rejected.', category: 'Tickets' },
    {
      event_type: 'TICKET_APPROVAL_REQUESTED',
      name: 'Ticket Approval Requested',
      description: 'Request approval (access/spend/change).',
      category: 'Tickets',
    },
    { event_type: 'TICKET_ASSIGNED', name: 'Ticket Assigned', description: 'Assigned to an agent/team.', category: 'Tickets' },
    {
      event_type: 'TICKET_CUSTOMER_REPLIED',
      name: 'Ticket Customer Replied',
      description: 'Customer reply received (portal/email).',
      category: 'Tickets',
    },
    { event_type: 'TICKET_ESCALATED', name: 'Ticket Escalated', description: 'Escalated to higher tier/team/queue.', category: 'Tickets' },
    {
      event_type: 'TICKET_INTERNAL_NOTE_ADDED',
      name: 'Ticket Internal Note Added',
      description: 'Internal/private note added.',
      category: 'Tickets',
    },
    { event_type: 'TICKET_MERGED', name: 'Ticket Merged', description: 'Ticket merged into another.', category: 'Tickets' },
    {
      event_type: 'TICKET_MESSAGE_ADDED',
      name: 'Ticket Message Added',
      description: 'Any message/comment added (public/private).',
      category: 'Tickets',
    },
    { event_type: 'TICKET_PRIORITY_CHANGED', name: 'Ticket Priority Changed', description: 'Priority updated.', category: 'Tickets' },
    {
      event_type: 'TICKET_QUEUE_CHANGED',
      name: 'Ticket Queue/Board Changed',
      description: 'Ticket moved between boards/queues.',
      category: 'Tickets',
    },
    { event_type: 'TICKET_REOPENED', name: 'Ticket Reopened', description: 'Closed ticket reopened.', category: 'Tickets' },
    { event_type: 'TICKET_SLA_STAGE_BREACHED', name: 'Ticket SLA Stage Breached', description: 'SLA breached.', category: 'Tickets' },
    { event_type: 'TICKET_SLA_STAGE_ENTERED', name: 'Ticket SLA Stage Entered', description: 'SLA stage started.', category: 'Tickets' },
    { event_type: 'TICKET_SLA_STAGE_MET', name: 'Ticket SLA Stage Met', description: 'SLA met.', category: 'Tickets' },
    { event_type: 'TICKET_SPLIT', name: 'Ticket Split', description: 'Ticket split into multiple tickets.', category: 'Tickets' },
    { event_type: 'TICKET_STATUS_CHANGED', name: 'Ticket Status Changed', description: 'Ticket moved between statuses.', category: 'Tickets' },
    { event_type: 'TICKET_TAGS_CHANGED', name: 'Ticket Tags Changed', description: 'Tags applied/removed on ticket.', category: 'Tickets' },
    { event_type: 'TICKET_TIME_ENTRY_ADDED', name: 'Ticket Time Entry Added', description: 'Time logged against ticket.', category: 'Tickets' },
    { event_type: 'TICKET_UNASSIGNED', name: 'Ticket Unassigned', description: 'Unassigned from agent/team.', category: 'Tickets' },
  ];

  const catalogEvents = [...baseEvents, ...proposedEvents];

  const toPayloadSchemaRef = (eventType) => {
    const pascal = String(eventType)
      .toLowerCase()
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    return `payload.${pascal}.v1`;
  };

  // Upsert each event individually using raw SQL to avoid Citus IMMUTABLE function issues
  // Knex's .onConflict().merge() generates CURRENT_TIMESTAMP which Citus rejects
  for (const e of catalogEvents) {
    const payloadSchemaRef = toPayloadSchemaRef(e.event_type);

    await knex.raw(`
      INSERT INTO system_event_catalog (event_id, event_type, name, description, category, payload_schema_ref, created_at, updated_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
      ON CONFLICT (event_type) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        payload_schema_ref = EXCLUDED.payload_schema_ref,
        updated_at = ?::timestamptz
    `, [e.event_type, e.name, e.description, e.category, payloadSchemaRef, now, now, now]);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {
  // No-op: this migration intentionally normalizes catalog metadata and schema refs.
};

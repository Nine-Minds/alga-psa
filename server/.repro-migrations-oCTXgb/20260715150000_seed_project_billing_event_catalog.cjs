'use strict';

const EVENTS = [
  ['PROJECT_MILESTONE_READY', 'Project Milestone Ready', 'A project billing milestone becomes ready for billing review.', 'payload.ProjectMilestoneReady.v1'],
  ['PROJECT_BUDGET_THRESHOLD_REACHED', 'Project Budget Threshold Reached', 'Project billing crosses a configured budget notification threshold.', 'payload.ProjectBudgetThresholdReached.v1'],
  ['PROJECT_BUDGET_EXCEEDED', 'Project Budget Exceeded', 'Billable project work first exceeds a hard budget cap and is written down.', 'payload.ProjectBudgetExceeded.v1'],
  ['PROJECT_BILLING_CONFIG_CREATED', 'Project Billing Configuration Created', 'Project billing is enabled and configured for a project.', 'payload.ProjectBillingConfigCreated.v1'],
  ['PROJECT_BILLING_CONFIG_UPDATED', 'Project Billing Configuration Updated', 'A project billing configuration is changed.', 'payload.ProjectBillingConfigUpdated.v1'],
  ['PROJECT_BILLING_CONFIG_DELETED', 'Project Billing Configuration Deleted', 'A project billing configuration is removed.', 'payload.ProjectBillingConfigDeleted.v1'],
  ['PROJECT_BILLING_SCHEDULE_ENTRY_CREATED', 'Project Billing Schedule Entry Created', 'A project billing milestone or deposit is added.', 'payload.ProjectBillingScheduleEntryCreated.v1'],
  ['PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED', 'Project Billing Schedule Entry Updated', 'A pending project billing schedule entry is changed.', 'payload.ProjectBillingScheduleEntryUpdated.v1'],
  ['PROJECT_BILLING_SCHEDULE_STATUS_CHANGED', 'Project Billing Schedule Status Changed', 'A project billing schedule entry changes lifecycle status.', 'payload.ProjectBillingScheduleStatusChanged.v1'],
  ['PROJECT_BILLING_SCHEDULE_ENTRY_DELETED', 'Project Billing Schedule Entry Deleted', 'A project billing schedule entry is removed.', 'payload.ProjectBillingScheduleEntryDeleted.v1'],
  ['PROJECT_BILLING_PAYMENT_STATUS_CHANGED', 'Project Billing Payment Status Changed', 'A flagged project payment prerequisite becomes satisfied, outstanding again, or requires a replacement invoice.', 'payload.ProjectBillingPaymentStatusChanged.v1'],
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) {
    await knex.schema.alterTable('system_event_catalog', (table) => {
      table.text('payload_schema_ref').nullable();
      table.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
    });
  }

  const now = new Date().toISOString();
  for (const [eventType, name, description, payloadSchemaRef] of EVENTS) {
    await knex.raw(
      `
        INSERT INTO system_event_catalog (
          event_id, event_type, name, description, category,
          payload_schema_ref, created_at, updated_at
        )
        VALUES (gen_random_uuid(), ?, ?, ?, 'Project Billing', ?, ?::timestamptz, ?::timestamptz)
        ON CONFLICT (event_type) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          payload_schema_ref = EXCLUDED.payload_schema_ref,
          updated_at = EXCLUDED.updated_at
      `,
      [eventType, name, description, payloadSchemaRef, now, now],
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  await knex('system_event_catalog')
    .whereIn('event_type', EVENTS.map(([eventType]) => eventType))
    .del();
};

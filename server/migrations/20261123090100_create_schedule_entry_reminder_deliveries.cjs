const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

// Schedule entry reminders (S2): the delivery ledger for the per-minute reminder scan.
// Same claim protocol as co_management_deliveries (shared/lib/deliveryLedger.ts), keyed by
// (tenant, entry_id, occurrence_start, user_id, lead_minutes). entry_id is the master entry for recurring series.
// No FKs: rows outlive entry/user edits and are purged by the scan after 30 days.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('schedule_entry_reminder_deliveries'))) {
    await knex.schema.createTable('schedule_entry_reminder_deliveries', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('entry_id').notNullable();
      table.timestamp('occurrence_start', { useTz: true }).notNullable();
      table.uuid('user_id').notNullable();
      table.integer('lead_minutes').notNullable();
      table.string('state', 16).notNullable().defaultTo('pending');
      table.integer('attempts').notNullable().defaultTo(1);
      table.uuid('notification_id').nullable();
      table.text('last_error').nullable();
      table.text('error_code').nullable();
      table.boolean('requires_reconciliation').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'entry_id', 'occurrence_start', 'user_id', 'lead_minutes']);
      // Supports the 30-day retention purge.
      table.index(['tenant', 'created_at'], 'schedule_entry_reminder_deliveries_retention_idx');
      table.check("state IN ('pending', 'sending', 'sent', 'failed')", [], 'schedule_entry_reminder_deliveries_state_check');
    });
  }
  await ensureTenantDistribution(knex, 'schedule_entry_reminder_deliveries');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('schedule_entry_reminder_deliveries');
};

exports.config = { transaction: false };

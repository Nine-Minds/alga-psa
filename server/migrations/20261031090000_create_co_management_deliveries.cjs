const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

// Co-managed L5: the ONE delivery ledger for co-managed notifications (in-app and email).
// Same claim protocol as base's ticket_comment_email_deliveries (shared/lib/deliveryLedger.ts),
// keyed by what makes a delivery unique: (tenant, delivery_kind, source_id, recipient).
// `delivery_kind` names channel + event (e.g. comment_email, routing_in_app). New table only:
// no trigger, no change to an existing table, no backfill.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_deliveries'))) {
    await knex.schema.createTable('co_management_deliveries', (table) => {
      table.uuid('tenant').notNullable();
      table.text('delivery_kind').notNullable();
      table.uuid('source_id').notNullable();
      table.text('recipient').notNullable();
      table.text('recipient_kind').notNullable();
      table.string('state', 16).notNullable();
      table.integer('attempts').notNullable().defaultTo(1);
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.text('last_error').nullable();
      table.text('error_code').nullable();
      table.boolean('requires_reconciliation').notNullable().defaultTo(false);
      table.jsonb('payload').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'delivery_kind', 'source_id', 'recipient']);
      table.index(['tenant', 'state', 'updated_at'], 'co_management_deliveries_recovery_idx');
      table.check("state IN ('sending', 'sent', 'failed')", [], 'co_management_deliveries_state_check');
      table.check("recipient_kind IN ('msp_user', 'customer_user', 'requester_contact', 'team')", [], 'co_management_deliveries_recipient_kind_check');
      table.check("delivery_kind ~ '^[a-z_]+$'", [], 'co_management_deliveries_kind_check');
    });
  }
  await ensureTenantDistribution(knex, 'co_management_deliveries');
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_management_deliveries'))) return;
  if (await knex('co_management_deliveries').first()) {
    throw new Error('Cannot remove retained co-managed deliveries');
  }
  await knex.schema.dropTable('co_management_deliveries');
};

exports.config = { transaction: false };

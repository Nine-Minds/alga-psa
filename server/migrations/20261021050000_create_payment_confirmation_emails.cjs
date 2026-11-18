/**
 * Durable "payment confirmation sent" marker, keyed by (tenant, payment_id).
 *
 * The PAYMENT_RECORDED subscriber claims a row here (INSERT ... ON CONFLICT DO
 * NOTHING) before sending, so concurrent or replayed deliveries of the same
 * payment produce at most one confirmation email regardless of bus idempotency.
 *
 * Brand-new empty table: distributed immediately, so no stale local heap data
 * can exist. Tenant is part of the primary key (Citus). No FK to
 * invoice_payments: the marker must outlive any payment-row maintenance.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('payment_confirmation_emails'))) {
    await knex.schema.createTable('payment_confirmation_emails', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('payment_id').notNullable();
      table.text('recipient_email').nullable();
      table.timestamp('claimed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'payment_id']);
    });
  }
  await ensureTenantDistribution(knex, 'payment_confirmation_emails');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payment_confirmation_emails');
};

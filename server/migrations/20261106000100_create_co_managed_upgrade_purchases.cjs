/**
 * Independent-upgrade purchases (CM L8b).
 *
 * The durable intent of a customer's own PSA seat purchase, written before the payment provider is
 * contacted and keyed by `operation_id`, so a lost response resumes the same purchase instead of
 * creating a second charge. Owned by the CUSTOMER tenant.
 *
 * The constraints are a historical schema snapshot. They must load with the standalone
 * migration payload, without application packages. The purchase-state integration tests
 * verify that this schema accepts every state written by the current domain.
 *
 * CREATE only; idempotent; distributed on `tenant`.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_upgrade_purchases';
const FK = 'co_upgrade_purchase_owner_fk';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.uuid('requested_by').notNullable();
      table.integer('quantity').notNullable();
      table.text('billing_interval').notNullable();
      table.text('price_id').notNullable();
      table.text('state').notNullable().defaultTo('preparing');
      table.text('customer_id').nullable();
      table.text('checkout_session_id').nullable();
      table.text('subscription_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      table.check('quantity >= 1 AND quantity <= 100000');
      table.check("billing_interval IN ('month', 'year') AND length(price_id) > 0");
      table.check("state IN ('preparing', 'checkout', 'paid', 'expired', 'payment_failed')", [], 'co_upgrade_purchase_state_check');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
  if (!(await knex('pg_constraint').where('conname', FK).whereRaw('conrelid = ?::regclass', [TABLE]).first())) {
    await knex.schema.alterTable(TABLE, (table) => table.foreign(['tenant'], FK).references(['tenant']).inTable('tenants'));
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_upgrade_one_pending_purchase
    ON ${TABLE} (tenant) WHERE state IN ('preparing', 'checkout', 'payment_failed')`);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove independent upgrade purchase history');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };

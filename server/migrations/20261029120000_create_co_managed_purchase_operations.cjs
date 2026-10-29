/**
 * Co-managed capacity purchase operations (CM L8a).
 *
 * The row is the durable intent of a pool-capacity purchase: it is written before the
 * payment provider is contacted, so a lost response resumes the same operation instead of
 * creating a second charge. Owned by the SPONSOR tenant. `quantity` is the absolute pool
 * target. `payment_failed` is a retained, still-pending state (recoverable, auditable);
 * it is folded into the final shape here rather than altered in later.
 *
 * CREATE only; zero foreign keys; distributed on `tenant`. Idempotent; safe to re-run.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_purchase_operations';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.integer('quantity').notNullable(); // Absolute pool target.
      table.text('state').notNullable().defaultTo('preparing');
      table.text('provider_reference').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      table.check('quantity >= 0 AND quantity <= 100000');
      table.check("state IN ('preparing', 'checkout', 'completed', 'expired', 'payment_failed')");
    });
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_pending_purchase
    ON ${TABLE} (tenant) WHERE state IN ('preparing', 'checkout', 'payment_failed')`);
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex(TABLE).first()) throw new Error('Cannot discard co-managed purchase history');
  await knex.schema.dropTable(TABLE);
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };

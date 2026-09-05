'use strict';

/**
 * Durable request-id history for usage period totals (mitigation of the
 * replay gap in the R3 period-total store).
 *
 * The live `usage_period_totals.request_id` column keeps only the LATEST
 * request id: once edit B replaces report A, replaying request A no longer
 * matches any live row and would flow into the create/replace path — silently
 * restoring A's content over B's. This table preserves every request id ever
 * consumed together with the exact content it wrote, so:
 *   - an identical replay of an already-applied request is acknowledged
 *     without mutating anything (the current stored total stands), and
 *   - reusing a request id with different content is rejected,
 * regardless of how many edits, deletes, or re-reports happened in between.
 *
 * Rows are never deleted; deleting or replacing a total keeps its history.
 */

const TABLE = 'usage_period_total_requests';

// Distribute a tenant-scoped table by tenant when running on a Citus cluster.
// No-op on plain Postgres (the function does not exist there).
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;`,
  );
  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(
      `SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;`,
    );
    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.text('request_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('client_contract_line_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('config_id').notNullable();
      table.date('period_start').notNullable();
      table.date('period_end').notNullable();
      table.integer('quantity').notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'request_id']);
    });
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT usage_period_total_requests_quantity_check CHECK (quantity >= 0)
    `);
    await distributeIfCitus(knex, TABLE);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// CREATE TABLE + create_distributed_table must not run inside a transaction
// on Citus.
exports.config = { transaction: false };

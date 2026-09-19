/**
 * Migration: persist the latest successful Entra sync's eligible-user count.
 *
 * Discovery owns `source_user_count`. A completed sync may observe a different
 * filtered population, so its count and observation time live separately.
 *
 * ADD COLUMN propagates to shards automatically on a distributed Citus table.
 * The guards keep the migration idempotent on both plain Postgres and Citus.
 */

const TABLE = 'entra_managed_tenants';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  const [hasCount, hasObservedAt] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'last_successful_sync_user_count'),
    knex.schema.hasColumn(TABLE, 'last_successful_sync_at'),
  ]);

  if (hasCount && hasObservedAt) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasCount) {
      table.integer('last_successful_sync_user_count').nullable();
    }
    if (!hasObservedAt) {
      table.timestamp('last_successful_sync_at', { useTz: true }).nullable();
    }
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  const [hasCount, hasObservedAt] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'last_successful_sync_user_count'),
    knex.schema.hasColumn(TABLE, 'last_successful_sync_at'),
  ]);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasCount) {
      table.dropColumn('last_successful_sync_user_count');
    }
    if (hasObservedAt) {
      table.dropColumn('last_successful_sync_at');
    }
  });
};

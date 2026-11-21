/**
 * Migration: entra_sync_run_tenants per-user failure visibility (EE-only).
 *
 * `failed_count` is the true number of contacts that failed to sync for the
 * client in this run. `user_issues` holds the capped list (100) of per-user
 * failures and field notices so the MSP can see which users failed and why.
 *
 * ADD COLUMN with a constant default propagates to shards automatically on a
 * distributed Citus table, and no UPDATE is issued (existing rows take the
 * default). Idempotent via hasColumn.
 */

const TABLE = 'entra_sync_run_tenants';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  const [hasFailedCount, hasUserIssues] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'failed_count'),
    knex.schema.hasColumn(TABLE, 'user_issues'),
  ]);

  if (hasFailedCount && hasUserIssues) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasFailedCount) {
      table.integer('failed_count').notNullable().defaultTo(0);
    }
    if (!hasUserIssues) {
      table.jsonb('user_issues').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    }
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  const [hasFailedCount, hasUserIssues] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'failed_count'),
    knex.schema.hasColumn(TABLE, 'user_issues'),
  ]);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasFailedCount) {
      table.dropColumn('failed_count');
    }
    if (hasUserIssues) {
      table.dropColumn('user_issues');
    }
  });
};

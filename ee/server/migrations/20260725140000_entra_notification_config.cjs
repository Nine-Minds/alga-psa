/**
 * Migration: entra_sync_settings.notification_config (EE-only).
 *
 * Which sync events are worth telling someone about. Defaults live in code
 * (repeated failures and review-queue arrivals on, per-run digest off), so an
 * empty object here means "the defaults", and a tenant that never opens the
 * setting still gets told when the sync starts failing.
 *
 * ADD COLUMN propagates to shards automatically on a distributed Citus table.
 */

const TABLE = 'entra_sync_settings';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn(TABLE, 'notification_config');
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.jsonb('notification_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn(TABLE, 'notification_config');
  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.dropColumn('notification_config');
  });
};

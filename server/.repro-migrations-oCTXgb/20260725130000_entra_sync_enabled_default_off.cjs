/**
 * Migration: automatic Entra sync defaults to off (EE-only).
 *
 * `sync_enabled` defaulted to true, so a tenant that merely connected Entra
 * acquired a recurring sync it never asked for — and the screen's only mention
 * of the schedule was a read-only "Next Sync Interval" line. Automatic sync is
 * now something a tenant turns on, from the console's Sync & schedule tab,
 * after a pilot has proved the mapping.
 *
 * Existing rows are set to false. Because of F6 (the scheduler gated on the
 * Enterprise add-on until 2026-07-22), the tenants actually running recurring
 * sync today are few and enumerable; ops gets that list before this ships —
 * see the enumeration query in the plan's "Note on the migrate-to-off
 * decision".
 *
 * `sync_interval_minutes` keeps its 1440 default: it is the cadence used once
 * enabled, not a statement that syncing is on.
 */

const TABLE = 'entra_sync_settings';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.boolean('sync_enabled').notNullable().defaultTo(false).alter();
  });

  await knex(TABLE).update({ sync_enabled: false, updated_at: knex.fn.now() });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.boolean('sync_enabled').notNullable().defaultTo(true).alter();
  });
};

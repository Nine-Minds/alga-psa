'use strict';

/**
 * Add `calendar_event_mappings.occurrence_index`: the occurrence -> master index
 * a Microsoft series needs so a cancelled occurrence can be applied to it.
 *
 * Graph reports a cancelled occurrence through `calendarView/delta` as an
 * `@removed` item carrying nothing but an opaque occurrence id, and a GET on
 * that id answers 404 — so once it is gone there is no way back to the series
 * master unless Alga recorded the link while the occurrence was still visible.
 * The index lives on the master's own mapping row as
 * `{ "<occurrence id>": "<occurrence start ISO>" }`, which keeps it bounded by
 * the delta window, makes it disappear with the master, and avoids per-occurrence
 * rows (those would collide with the existing
 * (tenant, schedule_entry_id, calendar_provider_id) unique index).
 *
 * Citus: a nullable ADD COLUMN on a distributed table is propagated by Citus and
 * rewrites nothing. Idempotent via hasColumn, so a re-run is a no-op.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('calendar_event_mappings'))) return;
  if (await knex.schema.hasColumn('calendar_event_mappings', 'occurrence_index')) return;

  await knex.schema.alterTable('calendar_event_mappings', (table) => {
    table.jsonb('occurrence_index').nullable();
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('calendar_event_mappings'))) return;
  if (!(await knex.schema.hasColumn('calendar_event_mappings', 'occurrence_index'))) return;

  await knex.schema.alterTable('calendar_event_mappings', (table) => {
    table.dropColumn('occurrence_index');
  });
};

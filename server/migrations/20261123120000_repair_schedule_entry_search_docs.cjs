/**
 * Repairs schedule entry search docs indexed before the schedule deep link existed:
 *
 * 1. url: they linked to /msp/schedule/{entry_id}, a route that does not exist. The indexer
 *    now builds /msp/schedule?entryId={entry_id} (buildScheduleEntryLink in @alga-psa/core),
 *    which opens the schedule at that entry. Only rows still carrying exactly the old URL for
 *    their own object_id are touched.
 * 2. required_permission: they required `schedule:read`, which no role grants (the RBAC
 *    resource is `user_schedule`), so search never returned a schedule entry to anyone. The
 *    indexer and the search type gate now use `user_schedule:read`.
 *
 * `search:reconcile` only rebuilds source rows newer than max(source_updated_at) per object
 * type, so without this migration existing docs would keep both defects until their entry is
 * next edited. The rows are fixed in place, in SQL.
 *
 * Entry ids are UUIDs, so encodeURIComponent (used by the link builder) leaves them unchanged
 * and plain concatenation produces the same URL the indexer writes. Values are bound, not
 * inline SQL text: knex.raw treats a bare `?` as a binding placeholder. The SET lists are bound
 * literals and column references (safe on Citus).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('app_search_index'))) {
    return;
  }

  // migration-lint: allow 5 - UPDATE limited to object_type schedule_entry rows of app_search_index whose url is still the dead /msp/schedule/{object_id} route; rewrites it to the schedule deep link, no data is lost
  await knex.raw(
    `
    UPDATE app_search_index
       SET url = ?::text || object_id
     WHERE object_type = 'schedule_entry'
       AND url = ?::text || object_id
  `,
    ['/msp/schedule?entryId=', '/msp/schedule/'],
  );

  // migration-lint: allow 5 - UPDATE limited to object_type schedule_entry rows of app_search_index still requiring the non-existent schedule:read permission; sets the real user_schedule:read, no data is lost
  await knex.raw(
    `
    UPDATE app_search_index
       SET required_permission = ?::text
     WHERE object_type = 'schedule_entry'
       AND required_permission = ?::text
  `,
    ['user_schedule:read', 'schedule:read'],
  );
};

/**
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {
  // Nothing to restore: the old URL pointed at a route that does not exist and the old
  // permission matched no role.
};

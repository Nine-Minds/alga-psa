/**
 * Contact search docs now carry the client name in the subtitle and phone
 * digits plus the legacy notes text in the body. `search:reconcile` only
 * re-indexes source rows newer than max(source_updated_at) for the object type,
 * so without a watermark reset the enriched indexer would never backfill
 * existing contacts.
 *
 * Rewinding source_updated_at (rather than deleting the rows) resets that
 * watermark while keeping contacts findable in global search until the next
 * reconcile run rebuilds them.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('app_search_index'))) {
    return;
  }

  // Bound literal, not 'epoch'::timestamptz: Citus rejects non-IMMUTABLE
  // expressions in the SET list of an UPDATE on a distributed table.
  // migration-lint: allow 5 - retroactive: single UPDATE limited to object_type contact rows of app_search_index to force a reindex; merged before the lint existed
  await knex('app_search_index')
    .where({ object_type: 'contact' })
    .update({ source_updated_at: knex.raw('?::timestamptz', ['1970-01-01T00:00:00.000Z']) });
};

/**
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {
  // Nothing to restore: reconcile rebuilds contact docs from the source rows.
};

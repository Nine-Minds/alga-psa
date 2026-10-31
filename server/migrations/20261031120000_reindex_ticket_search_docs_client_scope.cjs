/**
 * Ticket and ticket_comment search docs now carry acl.clientScopeId (the
 * ticket's client_id). `search:reconcile` only re-indexes source rows newer
 * than max(source_updated_at) for the object type, so existing rows (which
 * have client_scope_id NULL) would never be rebuilt without a watermark reset.
 *
 * Rewinding source_updated_at (rather than deleting rows) keeps the docs
 * findable for staff until the next reconcile run rebuilds them. Client-portal
 * readers are protected in the meantime by the fail-closed ticket verifier.
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
  // migration-lint: allow 5 - single UPDATE limited to object_type ticket/ticket_comment rows of app_search_index; only rewinds the reindex watermark so reconcile backfills client_scope_id, no data is lost
  await knex('app_search_index')
    .whereIn('object_type', ['ticket', 'ticket_comment'])
    .update({ source_updated_at: knex.raw('?::timestamptz', ['1970-01-01T00:00:00.000Z']) });
};

/**
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {
  // Nothing to restore: reconcile rebuilds ticket docs from the source rows.
};

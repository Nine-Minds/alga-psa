/**
 * Ticket and ticket_comment search docs now carry acl.clientScopeId (the owning
 * ticket's client_id). Docs indexed before that change have client_scope_id NULL,
 * which a client-portal principal must never be able to match.
 *
 * `search:reconcile` cannot be relied on to backfill them: it only rebuilds source
 * rows newer than max(source_updated_at) per object type, so a single live index
 * write after deploy moves the watermark and every legacy doc is skipped for good.
 * So this migration sets client_scope_id directly, in SQL, from the source rows.
 *
 * No watermark rewind: it would only trigger a reconcile rebuild of fields this
 * change does not touch, and the scope backfill must not depend on reconcile.
 *
 * Every join carries the tenant column (Citus co-located joins), and the SET lists
 * contain only column references.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('app_search_index'))) {
    return;
  }

  // migration-lint: allow 5 - UPDATE limited to object_type ticket rows of app_search_index; sets client_scope_id from the owning ticket's client_id (tenant-joined), no data is lost
  await knex.raw(`
    UPDATE app_search_index s
       SET client_scope_id = t.client_id
      FROM tickets t
     WHERE s.object_type = 'ticket'
       AND t.tenant = s.tenant
       AND t.ticket_id::text = s.object_id
       AND s.client_scope_id IS DISTINCT FROM t.client_id
  `);

  // migration-lint: allow 5 - UPDATE limited to object_type ticket_comment rows of app_search_index; sets client_scope_id from the comment's owning ticket client_id (tenant-joined), no data is lost
  await knex.raw(`
    UPDATE app_search_index s
       SET client_scope_id = t.client_id
      FROM comments c
      JOIN tickets t ON t.tenant = c.tenant AND t.ticket_id = c.ticket_id
     WHERE s.object_type = 'ticket_comment'
       AND c.tenant = s.tenant
       AND c.comment_id::text = s.object_id
       AND s.client_scope_id IS DISTINCT FROM t.client_id
  `);
};

/**
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {
  // Nothing to restore: the backfilled scope is the correct value.
};

// The native interaction reader keysets by date descending and ID ascending.
// Keep the mixed directions and NULL placement explicit for ordered B-tree scans.
//
// interactions is distributed in Citus, so the index is built outside a transaction.
// A valid index is kept; an interrupted concurrent build (which can leave an invalid
// index that IF NOT EXISTS would silently accept) is dropped and rebuilt.
exports.config = { transaction: false };

const INDEX = 'interactions_tenant_date_id_page_idx';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('interactions'))) return;
  const existing = await knex.raw(
    `SELECT i.indisvalid FROM pg_class idx
       JOIN pg_index i ON i.indexrelid = idx.oid
      WHERE idx.relname = ? AND i.indrelid = to_regclass('interactions')`,
    [INDEX]
  );
  if (existing.rows[0]?.indisvalid) return;
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  // tenant leads for Citus distribution; the rest matches the reader's keyset order.
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON interactions (tenant, interaction_date DESC NULLS LAST, interaction_id ASC)`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
};

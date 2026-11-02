// The native interaction reader keysets by date descending and ID ascending.
// Keep the mixed directions and NULL placement explicit for ordered B-tree scans.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('interactions')) {
    // tenant leads the index for Citus distribution and the remaining columns
    // match the native reader's mixed-direction keyset order.
    await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS interactions_tenant_date_id_page_idx ON interactions (tenant, interaction_date DESC NULLS LAST, interaction_id ASC)');
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('interactions'))) return;
  const citusCatalog = await knex.raw("SELECT to_regclass('pg_dist_partition') AS catalog");
  const distributed = citusCatalog.rows[0]?.catalog
    ? await knex.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'interactions'::regclass LIMIT 1")
    : { rows: [] };
  // Keep rollback valid for Citus installations whose distributed DROP INDEX
  // path does not accept PostgreSQL's CONCURRENTLY modifier.
  const concurrently = distributed.rows.length === 0 ? 'CONCURRENTLY ' : '';
  await knex.raw(`DROP INDEX ${concurrently}IF EXISTS interactions_tenant_date_id_page_idx`);
};

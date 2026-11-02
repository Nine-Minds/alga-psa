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
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS interactions_tenant_date_id_page_idx');
};

/** Supports the co-managed workflow's authorized external_ref selector lookup. */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tickets_tenant_external_ref_lookup_idx
      ON tickets (tenant, (attributes->>'external_ref'))
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS tickets_tenant_external_ref_lookup_idx');
};

/**
 * Keep deletion audit rows after the tenant row is removed. The tenant UUID is
 * retained as historical identity; it is intentionally no longer a live FK.
 */
exports.up = async function up(knex) {
  const tableExists = await knex.schema.hasTable('pending_tenant_deletions');
  if (!tableExists) return;

  await knex.raw(`ALTER TABLE pending_tenant_deletions
    DROP CONSTRAINT IF EXISTS pending_tenant_deletions_tenant_foreign`);
};

exports.down = async function down(knex) {
  const tableExists = await knex.schema.hasTable('pending_tenant_deletions');
  if (!tableExists) return;

  // A rollback is only valid while every audit row still has a live tenant.
  await knex.raw(`ALTER TABLE pending_tenant_deletions
    ADD CONSTRAINT pending_tenant_deletions_tenant_foreign
    FOREIGN KEY (tenant) REFERENCES tenants(tenant)`);
};

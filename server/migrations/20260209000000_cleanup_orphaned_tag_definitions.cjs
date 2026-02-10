/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants (Citus compatibility: operate per-tenant)
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    await knex.raw(`
      DELETE FROM tag_definitions
      WHERE tenant = ?
        AND tag_id NOT IN (
          SELECT DISTINCT tag_id
          FROM tag_mappings
          WHERE tenant = ?
        )
    `, [tenant, tenant]);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // No-op: deleted data cannot be restored
};

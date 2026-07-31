const MIGRATION_TENANT = 'migration:20260712103000_add_quotes_opportunity_fk';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for orphaned quote opportunity cleanup';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    await knex.raw(`
      UPDATE quotes AS q
      SET opportunity_id = NULL
      WHERE q.tenant = ?::uuid
        AND q.opportunity_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM opportunities AS o
          WHERE o.tenant = q.tenant
            AND o.opportunity_id = q.opportunity_id
        )
    `, [tenant]);
  }

  await knex.schema.alterTable('quotes', (table) => {
    table.foreign(['tenant', 'opportunity_id'], 'fk_quotes_opportunity')
      .references(['tenant', 'opportunity_id'])
      .inTable('opportunities');
  });
  await knex.raw('CREATE INDEX idx_quotes_tenant_opportunity ON quotes (tenant, opportunity_id)');
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_quotes_tenant_opportunity');
  await knex.raw('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS fk_quotes_opportunity');
};

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

  // Orphan cleanup in two steps instead of a correlated UPDATE. On Citus,
  // `opportunities` is distributed but `quotes` may still be a local table, and
  // an UPDATE that joins the two is rejected ("relation quotes is not
  // distributed"). Reading each side separately works on both Citus and plain
  // Postgres.
  for (const { tenant } of tenants) {
    const { rows: referenced } = await knex.raw(`
      SELECT DISTINCT opportunity_id
      FROM quotes
      WHERE tenant = ?::uuid
        AND opportunity_id IS NOT NULL
    `, [tenant]);
    const referencedIds = referenced.map((row) => row.opportunity_id);
    if (referencedIds.length === 0) continue;

    const { rows: existing } = await knex.raw(`
      SELECT opportunity_id
      FROM opportunities
      WHERE tenant = ?::uuid
        AND opportunity_id = ANY(?::uuid[])
    `, [tenant, referencedIds]);
    const existingIds = new Set(existing.map((row) => row.opportunity_id));
    const orphanedIds = referencedIds.filter((id) => !existingIds.has(id));
    if (orphanedIds.length === 0) continue;

    await knex.raw(`
      UPDATE quotes
      SET opportunity_id = NULL
      WHERE tenant = ?::uuid
        AND opportunity_id = ANY(?::uuid[])
    `, [tenant, orphanedIds]);
  }

  // On Citus, `opportunities` is distributed but `quotes` is not, so the FK is
  // rejected ("relation quotes is not distributed"). Add the FK only when it is
  // valid; otherwise the link stays logical and the index below still serves
  // lookups. Mirrors server/migrations/20260702140000_add_sales_order_quote_link.cjs.
  const { rows: citusRows } = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  let canAddOpportunityFk = true;
  if (Boolean(citusRows?.[0]?.enabled)) {
    const { rows } = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'quotes'::regclass) AS is_distributed");
    canAddOpportunityFk = Boolean(rows?.[0]?.is_distributed);
  }
  if (canAddOpportunityFk) {
    await knex.schema.alterTable('quotes', (table) => {
      table.foreign(['tenant', 'opportunity_id'], 'fk_quotes_opportunity')
        .references(['tenant', 'opportunity_id'])
        .inTable('opportunities');
    });
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_quotes_tenant_opportunity ON quotes (tenant, opportunity_id)');
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_quotes_tenant_opportunity');
  await knex.raw('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS fk_quotes_opportunity');
};

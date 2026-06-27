const MIGRATION_TENANT = 'migration:20250217204649_update_contact_based_comments';
const COMMENT_TENANT_DISCOVERY_REASON = 'discover tenants with historical comments for contact author backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();

  // Cluster/session setting for historical Citus repair; tenantDb has no schema/session facade.
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
  await knex.transaction(async (trx) => {
    const migrationDb = tenantDb(trx, MIGRATION_TENANT);
    const tenants = await migrationDb.unscoped('comments', COMMENT_TENANT_DISCOVERY_REASON)
      .distinct('tenant')
      .pluck('tenant');

    // Process each tenant separately to maintain proper sharding
    for (const tenant of tenants) {
      console.log(`Skipping potentially redundant contact-based comment update for tenant ${tenant} in migration 20250217204649 as contact_id column no longer exists.`);
    }
  });
};

exports.down = async function(knex) {
  // No need for down migration as the data changes are handled
  // in the column changes migration's down function
};

exports.config = { transaction: false };

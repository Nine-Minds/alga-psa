const MIGRATION_TENANT = 'migration:20250217204650_update_remaining_comments';
const COMMENT_TENANT_DISCOVERY_REASON = 'discover tenants with historical comments for unknown author backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();

  await knex.transaction(async (trx) => {
    const migrationDb = tenantDb(trx, MIGRATION_TENANT);
    const tenants = await migrationDb.unscoped('comments', COMMENT_TENANT_DISCOVERY_REASON)
      .distinct('tenant')
      .pluck('tenant');

    // Process each tenant separately to maintain proper sharding
    for (const tenant of tenants) {
      const db = tenantDb(trx, tenant);
      // Set remaining comments to unknown for this tenant
      await db.table('comments')
        .whereNull('user_id')
        .update({
          author_type: 'unknown'
        });
    }
  });
};

exports.down = async function(knex) {
  // No need for down migration as the data changes are handled
  // in the column changes migration's down function
};

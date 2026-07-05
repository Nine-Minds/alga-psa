const MIGRATION_TENANT = 'migration:20250217204651_cleanup_comment_states';
const COMMENT_TENANT_DISCOVERY_REASON = 'discover tenants with historical comments for author state cleanup';

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
      // Update any comments that don't have a valid author_type
      await db.table('comments')
        .whereNotIn('author_type', ['internal', 'client', 'unknown'])
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

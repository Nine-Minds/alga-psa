const MIGRATION_TENANT = 'migration:20250217204648_update_user_based_comments';
const COMMENT_TENANT_DISCOVERY_REASON = 'discover tenants with historical comments for user author backfill';

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
      // Get all comments with their users for this tenant
      const commentsWithUsers = await db.tenantJoin(
        db.table('comments as c')
          .select('c.comment_id', 'c.tenant', 'c.user_id', 'u.user_type'),
        'users as u',
        'c.user_id',
        'u.user_id',
        { type: 'left' }
      );

      // Update author_type based on user's type
      for (const comment of commentsWithUsers) {
        await db.table('comments')
          .where('comment_id', comment.comment_id)
          .update({
            author_type: comment.user_type === 'internal' ? 'internal' :
                        comment.user_type === 'client' ? 'client' : 'unknown'
          });
      }
    }
  });
};

exports.down = async function(knex) {
  // No need for down migration as the data changes are handled
  // in the column changes migration's down function
};

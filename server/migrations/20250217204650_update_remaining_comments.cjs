const { getCommentTenants } = require('./20250217204647_get_comment_tenants.cjs');

exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    const tenants = await getCommentTenants(trx);

    // Process each tenant separately to maintain proper sharding
    for (const tenant of tenants) {
      // Set remaining comments to unknown for this tenant
      await trx('comments')
        .where('tenant', tenant)
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
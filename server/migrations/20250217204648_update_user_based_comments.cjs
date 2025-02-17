const { getCommentTenants } = require('./20250217204647_get_comment_tenants.cjs');

exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    const tenants = await getCommentTenants(trx);

    // Process each tenant separately to maintain proper sharding
    for (const tenant of tenants) {
      // Get all comments with their users for this tenant
      const commentsWithUsers = await trx('comments as c')
        .select('c.comment_id', 'c.tenant', 'c.user_id', 'u.user_type')
        .leftJoin('users as u', function() {
          this.on('c.user_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .where('c.tenant', tenant);

      // Update author_type based on user's type
      for (const comment of commentsWithUsers) {
        await trx('comments')
          .where('comment_id', comment.comment_id)
          .andWhere('tenant', tenant)
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
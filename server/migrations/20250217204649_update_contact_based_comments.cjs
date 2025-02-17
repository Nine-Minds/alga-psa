const { getCommentTenants } = require('./20250217204647_get_comment_tenants.cjs');

exports.up = async function(knex) {
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
    const tenants = await getCommentTenants(knex);

    // Process each tenant separately to maintain proper sharding
    for (const tenant of tenants) {
      // Get comments with contact info for this tenant
      const contactComments = await knex('comments as c')
        .select('c.comment_id', 'c.contact_id', 'c.tenant', 'u.user_id')
        .leftJoin('users as u', function() {
          this.on('u.contact_id', '=', 'c.contact_id')
              .andOn('u.tenant', '=', 'c.tenant');
        })
        .where('c.tenant', tenant)
        .andWhere('u.user_type', 'client')

      // Update contact-based comments
      for (const comment of contactComments) {
        if (!comment.contact_id) continue;
        await knex('comments')
          .where('comment_id', comment.comment_id)
          .andWhere('tenant', tenant)
          .update({
            user_id: comment.user_id,
            author_type: 'client'
          });
      }
    }
  });
};

exports.down = async function(knex) {
  // No need for down migration as the data changes are handled
  // in the column changes migration's down function
};

exports.config = { transaction: false };

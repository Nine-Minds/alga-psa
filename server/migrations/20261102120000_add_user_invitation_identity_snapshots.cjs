exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('user_invitations', 'email_normalized'))) {
    await knex.schema.alterTable('user_invitations', table => {
      table.text('email_normalized').notNullable().defaultTo('');
    });
  }
  if (!(await knex.schema.hasColumn('user_invitations', 'invited_user_id'))) {
    await knex.schema.alterTable('user_invitations', table => table.uuid('invited_user_id'));
  }

  // Citus requires each update to name a tenant distribution key. Keep the
  // backfill bounded so old invitation tables do not produce unbounded writes.
  const tenants = await knex('user_invitations').distinct('tenant');
  for (const { tenant } of tenants) {
    let updated;
    do {
      updated = await knex('user_invitations').where({ tenant }).where('email_normalized', '')
        .whereIn('invitation_id', knex('user_invitations').select('invitation_id').where({ tenant })
          .where('email_normalized', '').limit(500))
        .update({ email_normalized: knex.raw('lower(trim(email))') });
    } while (updated > 0);

    do {
      updated = await knex.raw(`UPDATE user_invitations invitation
        SET invited_user_id = member.user_id
        FROM users member
        WHERE invitation.tenant = ? AND member.tenant = invitation.tenant
          AND invitation.invited_user_id IS NULL AND member.user_type = 'internal'
          AND lower(trim(member.email)) = invitation.email_normalized
          AND invitation.invitation_id IN (
            SELECT pending.invitation_id FROM user_invitations pending
            JOIN users matching ON matching.tenant = pending.tenant
              AND matching.user_type = 'internal'
              AND lower(trim(matching.email)) = pending.email_normalized
            WHERE pending.tenant = ? AND pending.invited_user_id IS NULL LIMIT 500
          )`, [tenant, tenant]);
      updated = updated.rowCount;
    } while (updated > 0);
  }

  await knex.raw('ALTER TABLE user_invitations ALTER COLUMN email_normalized DROP DEFAULT');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_invitations_email_normalized ON user_invitations (tenant, email_normalized)');
};

exports.down = async function(knex) {
  await knex.schema.alterTable('user_invitations', (table) => {
    table.dropIndex(['tenant', 'email_normalized'], 'idx_user_invitations_email_normalized');
    table.dropColumn('email_normalized');
    table.dropColumn('invited_user_id');
  });
};

exports.config = { transaction: false };

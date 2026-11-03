/**
 * Persist the canonical email key used by invitation lookups. Some shared
 * environments already have this column from an untracked schema change, so
 * make the forward migration safe to apply to both the canonical schema and
 * that drifted schema without changing their migration ledger.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('user_invitations', 'email_normalized'))) {
    await knex.schema.alterTable('user_invitations', (table) => {
      table.text('email_normalized').nullable();
    });
  }

  // Compute the canonical key in application code and scope each write to its
  // tenant so this data migration is valid for Citus-distributed tables too.
  const invitations = await knex('user_invitations')
    .select('tenant', 'invitation_id', 'email', 'email_normalized');
  for (const invitation of invitations) {
    const normalizedEmail = invitation.email.toLowerCase();
    if (invitation.email_normalized === normalizedEmail) continue;
    await knex('user_invitations')
      .where({ tenant: invitation.tenant, invitation_id: invitation.invitation_id })
      .update({ email_normalized: normalizedEmail });
  }

  let distributed = false;
  try {
    const result = await knex.raw(
      "SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'user_invitations'::regclass) AS distributed"
    );
    distributed = Boolean(result.rows?.[0]?.distributed);
  } catch {
    // Plain PostgreSQL has no pg_dist_partition catalog.
  }

  if (distributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'user_invitations',
        $$ALTER TABLE %s ALTER COLUMN email_normalized SET NOT NULL$$
      )
    `);
    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = 'user_invitations'::regclass
        AND attname = 'email_normalized'
        AND attnotnull = false
    `);
  } else {
    await knex.raw('ALTER TABLE user_invitations ALTER COLUMN email_normalized SET NOT NULL');
  }
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_user_invitations_email_normalized ON user_invitations (tenant, email_normalized)'
  );
};

// Citus shard operations cannot run inside a transaction block.
exports.config = { transaction: false };

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_user_invitations_email_normalized');
  if (await knex.schema.hasColumn('user_invitations', 'email_normalized')) {
    await knex.schema.alterTable('user_invitations', (table) => {
      table.dropColumn('email_normalized');
    });
  }
};

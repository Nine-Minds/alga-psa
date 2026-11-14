/**
 * Reply tokens without an expiry have no defensible remaining lifetime. Keep
 * their lookup identity so inbound processing can recognize and quarantine
 * them, but revoke their authority by assigning an already-expired timestamp.
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('email_reply_tokens');
  if (!exists) return;

  let batch;
  do {
    batch = await knex('email_reply_tokens')
      .whereNull('expires_at')
      .select('tenant', 'token')
      .orderBy(['tenant', 'token'])
      .limit(500);
    for (const row of batch) {
      await knex('email_reply_tokens').where({ tenant: row.tenant, token: row.token }).whereNull('expires_at')
        .update({ expires_at: new Date(0) });
    }
  } while (batch.length === 500);

  await knex.schema.alterTable('email_reply_tokens', (table) => {
    // migration-lint: allow 3 — legacy null expiries are revoked and preserved for inbound quarantine.
    table.timestamp('expires_at', { useTz: true }).notNullable().alter();
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('email_reply_tokens');
  if (!exists) return;

  await knex.schema.alterTable('email_reply_tokens', (table) => {
    table.timestamp('expires_at', { useTz: true }).nullable().alter();
  });
};

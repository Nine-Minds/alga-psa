exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('appliance_claim_tokens');
  if (hasTable) {
    return;
  }

  await knex.schema.createTable('appliance_claim_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('token_hash').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.uuid('claimed_user_id').nullable();
    table.uuid('claimed_tenant_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('metadata').nullable();

    table.unique(['token_hash'], { indexName: 'appliance_claim_tokens_token_hash_unique' });
    table.index(['expires_at'], 'idx_appliance_claim_tokens_expires_at');
    table.index(['claimed_at'], 'idx_appliance_claim_tokens_claimed_at');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX appliance_claim_tokens_single_active_idx
      ON appliance_claim_tokens ((1))
      WHERE claimed_at IS NULL
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS appliance_claim_tokens_single_active_idx');
  await knex.schema.dropTableIfExists('appliance_claim_tokens');
};

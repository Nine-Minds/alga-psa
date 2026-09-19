/**
 * Create verification challenge storage for MSP SSO domain claim ownership checks.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_domain_verification_challenges');
  if (!hasTable) {
    await knex.schema.createTable('msp_sso_domain_verification_challenges', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('claim_id').notNullable();
      table.text('challenge_type').notNullable().defaultTo('dns_txt');
      table.text('challenge_label').notNullable();
      table.text('challenge_value').notNullable();
      table.text('challenge_token_hash').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('expires_at', { useTz: true }).nullable();
      table.timestamp('verified_at', { useTz: true }).nullable();
      table.timestamp('invalidated_at', { useTz: true }).nullable();
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table
        .foreign(['tenant', 'claim_id'])
        .references(['tenant', 'id'])
        .inTable('msp_sso_tenant_login_domains')
        .onDelete('CASCADE');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS msp_sso_domain_verification_challenges_active_claim_uniq
    ON msp_sso_domain_verification_challenges (tenant, claim_id)
    WHERE is_active = true;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS msp_sso_domain_verification_challenges_claim_idx
    ON msp_sso_domain_verification_challenges (tenant, claim_id, is_active, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS msp_sso_domain_verification_challenges_token_hash_idx
    ON msp_sso_domain_verification_challenges (tenant, challenge_token_hash);
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'msp_sso_domain_verification_challenges'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(
        "SELECT create_distributed_table('msp_sso_domain_verification_challenges', 'tenant')"
      );
    }
  } else {
    console.warn(
      '[create_msp_sso_domain_verification_challenges] Skipping create_distributed_table (function unavailable)'
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('msp_sso_domain_verification_challenges');
};

exports.config = { transaction: false };

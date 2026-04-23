/**
 * Sign in with Apple identity mapping (App Store guideline 4.8).
 *
 * Maps the stable Apple `sub` claim to an existing Alga user/tenant. Stores
 * the encrypted Apple refresh token so account deletion can revoke it
 * (guideline 5.1.1(v)).
 *
 * Reference table (replicated across Citus nodes) because sign-in lookups
 * are tenant-less: the client only knows the Apple identity until we've
 * resolved which tenant it belongs to.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('apple_user_identities');
  if (!hasTable) {
    await knex.schema.createTable('apple_user_identities', (table) => {
      table.text('apple_user_id').primary();
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.text('email').nullable();
      table.boolean('is_private_email').notNullable().defaultTo(false);
      table.text('apple_refresh_token_enc').nullable();
      table.timestamp('linked_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_sign_in_at').nullable();

      table.index(['tenant', 'user_id']);
      table.index(['email']);
    });
  }

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_reference_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const distributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'apple_user_identities'::regclass
      ) AS is_distributed;
    `);
    if (!distributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_reference_table('apple_user_identities')");
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('apple_user_identities');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };

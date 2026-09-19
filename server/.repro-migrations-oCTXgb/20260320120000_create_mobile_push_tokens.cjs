/**
 * Create mobile_push_tokens table for Expo push notification delivery.
 * Stores one Expo push token per user per device per tenant.
 *
 * Citus-compatible: composite PK with tenant, distributed by tenant,
 * colocated with tenants table.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('mobile_push_tokens');
  if (!hasTable) {
    await knex.schema.createTable('mobile_push_tokens', (table) => {
      table.uuid('mobile_push_token_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.text('device_id').notNullable();
      table.text('expo_push_token').notNullable();
      table.text('platform').notNullable();
      table.text('app_version').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_used_at', { useTz: true }).nullable();

      // Composite PK for Citus (tenant must be part of the distribution key)
      table.primary(['mobile_push_token_id', 'tenant']);

      // One token per user per device per tenant
      table.unique(['tenant', 'user_id', 'device_id']);

      // Foreign keys
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table
        .foreign(['tenant', 'user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('CASCADE');
    });
  }

  // Indexes for common queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_tenant_user_active
    ON mobile_push_tokens (tenant, user_id)
    WHERE is_active = true;
  `);

  // Check for Citus and distribute
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
        WHERE logicalrelid = 'mobile_push_tokens'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('mobile_push_tokens', 'tenant', colocate_with => 'tenants')");
    }
  } else {
    console.warn('[create_mobile_push_tokens] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mobile_push_tokens');
};

exports.config = { transaction: false };

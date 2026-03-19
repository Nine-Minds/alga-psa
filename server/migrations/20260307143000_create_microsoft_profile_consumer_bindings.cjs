/**
 * Create tenant-scoped Microsoft profile consumer bindings.
 *
 * Each tenant consumer selects exactly one Microsoft profile through an
 * explicit binding row. Legacy Microsoft consumers are backfilled in
 * application code; Teams remains explicit-only.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profile_consumer_bindings');
  if (!hasTable) {
    await knex.schema.createTable('microsoft_profile_consumer_bindings', (table) => {
      table.uuid('tenant').notNullable();
      table.text('consumer_type').notNullable();
      table.uuid('profile_id').notNullable();
      table.uuid('created_by');
      table.uuid('updated_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'consumer_type']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table
        .foreign(['tenant', 'profile_id'])
        .references(['tenant', 'profile_id'])
        .inTable('microsoft_profiles')
        .onDelete('RESTRICT');
    });
  }

  await knex.raw(`
    ALTER TABLE microsoft_profile_consumer_bindings
    DROP CONSTRAINT IF EXISTS microsoft_profile_consumer_bindings_consumer_type_check;
  `);

  await knex.raw(`
    ALTER TABLE microsoft_profile_consumer_bindings
    ADD CONSTRAINT microsoft_profile_consumer_bindings_consumer_type_check
    CHECK (consumer_type IN ('msp_sso', 'email', 'calendar', 'teams'));
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS microsoft_profile_consumer_bindings_tenant_profile_idx
    ON microsoft_profile_consumer_bindings (tenant, profile_id);
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
        WHERE logicalrelid = 'microsoft_profile_consumer_bindings'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('microsoft_profile_consumer_bindings', 'tenant', colocate_with => 'microsoft_profiles')");
    }
  } else {
    console.warn('[create_microsoft_profile_consumer_bindings] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('microsoft_profile_consumer_bindings');
};

exports.config = { transaction: false };

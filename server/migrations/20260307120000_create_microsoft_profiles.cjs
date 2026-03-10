/**
 * Create tenant-scoped Microsoft profile records.
 *
 * Secret material remains in the tenant secret provider; SQL stores only
 * metadata plus the secret reference name.
 *
 * The `is_default` flag is profile-management metadata only. Consumer routing
 * belongs to explicit rows in `microsoft_profile_consumer_bindings`.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profiles');
  if (!hasTable) {
    await knex.schema.createTable('microsoft_profiles', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('profile_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('display_name').notNullable();
      table.text('display_name_normalized').notNullable();
      table.text('client_id').notNullable().defaultTo('');
      table.text('tenant_id').notNullable().defaultTo('common');
      table.text('client_secret_ref').notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.boolean('is_archived').notNullable().defaultTo(false);
      table.timestamp('archived_at', { useTz: true });
      table.uuid('created_by');
      table.uuid('updated_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'profile_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS microsoft_profiles_tenant_display_name_active_uniq
    ON microsoft_profiles (tenant, display_name_normalized)
    WHERE is_archived = false;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS microsoft_profiles_tenant_default_active_uniq
    ON microsoft_profiles (tenant, is_default)
    WHERE is_default = true AND is_archived = false;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS microsoft_profiles_tenant_active_idx
    ON microsoft_profiles (tenant, is_archived, is_default, display_name);
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
        WHERE logicalrelid = 'microsoft_profiles'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('microsoft_profiles', 'tenant', colocate_with => 'tenants')");
    }
  } else {
    console.warn('[create_microsoft_profiles] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('microsoft_profiles');
};

exports.config = { transaction: false };

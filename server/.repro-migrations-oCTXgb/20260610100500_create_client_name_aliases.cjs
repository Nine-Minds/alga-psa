/**
 * Create client_name_aliases mapping table.
 *
 * Purpose: map alternate client names (as they appear in third-party service
 * emails, e.g. monitoring alert subjects) -> client_id, per tenant. Used by
 * inbound email rules when an extracted name doesn't exactly match
 * clients.client_name.
 *
 * Notes:
 * - Alias matching is case-insensitive; uniqueness enforced via (tenant, lower(alias))
 *   so an alias resolves to exactly one client per tenant.
 * - We distribute by tenant when running under Citus (best-effort).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('client_name_aliases');
  if (!hasTable) {
    await knex.schema.createTable('client_name_aliases', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

      table.uuid('client_id').notNullable();
      table.text('alias').notNullable();

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'id']);
    });
  }

  // Fast lookup by client.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS client_name_aliases_tenant_client_idx
    ON client_name_aliases (tenant, client_id);
  `);

  // Enforce uniqueness per tenant, case-insensitive.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_name_aliases_tenant_alias_uniq
    ON client_name_aliases (tenant, lower(alias));
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
        WHERE logicalrelid = 'client_name_aliases'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      // create_distributed_table is not allowed inside a transaction in some Citus configs.
      await knex.raw("SELECT create_distributed_table('client_name_aliases', 'tenant')");
    }
  } else {
    console.warn('[create_client_name_aliases] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('client_name_aliases');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };

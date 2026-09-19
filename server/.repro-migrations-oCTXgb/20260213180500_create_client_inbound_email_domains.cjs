/**
 * Create client_inbound_email_domains mapping table.
 *
 * Purpose: Explicitly map inbound sender email domains -> client_id, per tenant.
 * Enforce uniqueness so a given domain can belong to at most one client per tenant.
 *
 * Notes:
 * - Domain matching is case-insensitive; we store domains normalized to lowercase and
 *   also enforce uniqueness via (tenant, lower(domain)).
 * - We distribute by tenant when running under Citus (best-effort).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('client_inbound_email_domains');
  if (!hasTable) {
    await knex.schema.createTable('client_inbound_email_domains', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

      table.uuid('client_id').notNullable();
      table.text('domain').notNullable();

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'id']);
    });
  }

  // Fast lookup by client.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS client_inbound_email_domains_tenant_client_idx
    ON client_inbound_email_domains (tenant, client_id);
  `);

  // Enforce uniqueness per tenant, case-insensitive.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_inbound_email_domains_tenant_domain_uniq
    ON client_inbound_email_domains (tenant, lower(domain));
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
        WHERE logicalrelid = 'client_inbound_email_domains'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      // create_distributed_table is not allowed inside a transaction in some Citus configs.
      await knex.raw("SELECT create_distributed_table('client_inbound_email_domains', 'tenant')");
    }
  } else {
    console.warn('[create_client_inbound_email_domains] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('client_inbound_email_domains');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };

/**
 * Tenant tier system migration:
 * 1. Backfill all NULL/empty tenant plans to 'pro' (existing tenants grandfathered)
 * 2. Create tenant_addons table for per-tenant add-on activations
 * 3. Distribute tenant_addons on Citus if available
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  // Backfill: existing tenants with NULL or empty plan become 'pro'
  await knex('tenants')
    .whereNull('plan')
    .orWhere('plan', '')
    .update({ plan: 'pro' });

  // Create tenant_addons table
  const hasTable = await knex.schema.hasTable('tenant_addons');
  if (!hasTable) {
    await knex.schema.createTable('tenant_addons', (table) => {
      table.uuid('tenant').notNullable();
      table.text('addon_key').notNullable();
      table.timestamp('activated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).nullable();
      table.jsonb('metadata').nullable();
      table.primary(['tenant', 'addon_key']);
      table.foreign('tenant').references('tenants.tenant');
    });
  }

  // Distribute on Citus if available
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
        WHERE logicalrelid = 'tenant_addons'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('tenant_addons', 'tenant')");
    }
  } else {
    console.warn('[tenant_tier_system] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('tenant_addons');
  // Cannot rollback plan backfill - we don't know which tenants had NULL originally
  console.log('Rollback: tenant_addons dropped. Plan backfill not reversed (intentional).');
};

exports.config = { transaction: false };

/**
 * Tenant tier system migration:
 * 1. Backfill all NULL/empty tenant plans to 'pro' (existing tenants grandfathered)
 * 2. Create tenant_addons table for per-tenant add-on activations
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
  await knex.schema.createTable('tenant_addons', (table) => {
    table.uuid('tenant').notNullable();
    table.text('addon_key').notNullable();
    table.timestamp('activated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).nullable();
    table.jsonb('metadata').nullable();
    table.primary(['tenant', 'addon_key']);
    table.foreign('tenant').references('tenants.tenant');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('tenant_addons');
  // Cannot rollback plan backfill - we don't know which tenants had NULL originally
  console.log('Rollback: tenant_addons dropped. Plan backfill not reversed (intentional).');
};

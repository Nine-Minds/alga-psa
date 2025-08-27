/**
 * Add licensed_user_count column to tenants table for tracking Stripe subscription license counts
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('tenants', (table) => {
    table.integer('licensed_user_count').nullable().comment('Number of licensed MSP users from Stripe subscription');
    table.timestamp('last_license_update').nullable().comment('Last time the license count was updated from Stripe');
    table.string('stripe_event_id', 255).nullable().comment('Last Stripe event ID processed for idempotency');
  });
  
  // Add index for performance and Citus shard pruning
  await knex.schema.alterTable('tenants', (table) => {
    table.index(['tenant', 'stripe_event_id'], 'idx_tenants_tenant_stripe_event');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('tenants', (table) => {
    table.dropIndex(['tenant', 'stripe_event_id'], 'idx_tenants_tenant_stripe_event');
  });
  
  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('licensed_user_count');
    table.dropColumn('last_license_update');
    table.dropColumn('stripe_event_id');
  });
};
/**
 * Migration: Create pending_tenant_deletions table
 *
 * This table tracks tenant deletions initiated by subscription cancellation
 * or manual admin action. It stores workflow state, deletion timing, and
 * a snapshot of tenant statistics for audit purposes.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  // Create the pending_tenant_deletions table
  await knex.schema.createTable('pending_tenant_deletions', (table) => {
    // Primary key
    table.uuid('deletion_id').notNullable().primary();

    // Foreign key to tenants (this is the tenant being deleted)
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');

    // Trigger information
    table.text('trigger_source').notNullable(); // 'stripe_webhook' | 'nineminds_extension' | 'manual'
    table.uuid('triggered_by'); // User ID if manual or extension trigger
    table.text('subscription_external_id'); // Stripe subscription ID if from webhook

    // Timing
    table.timestamp('canceled_at').notNullable();
    table.timestamp('scheduled_deletion_date').notNullable(); // 90 days from canceled_at

    // Temporal workflow reference
    table.text('workflow_id').notNullable();
    table.text('workflow_run_id');

    // Status tracking
    // 'pending' | 'awaiting_confirmation' | 'confirmed' | 'deleting' | 'deleted' | 'rolled_back' | 'failed'
    table.string('status', 50).notNullable().defaultTo('pending');

    // Tenant statistics snapshot at time of cancellation
    table.jsonb('stats_snapshot').notNullable();

    // Confirmation details
    table.text('confirmation_type'); // 'immediate' | '30_days' | '90_days' | 'auto_90_days'
    table.uuid('confirmed_by'); // User ID who confirmed
    table.timestamp('confirmed_at');
    table.timestamp('deletion_scheduled_for'); // Actual deletion date after confirmation

    // Deletion completion
    table.timestamp('deleted_at');

    // Rollback details
    table.text('rollback_reason');
    table.uuid('rolled_back_by');
    table.timestamp('rolled_back_at');

    // Error tracking
    table.text('error');

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes
    table.unique(['tenant']); // One active deletion per tenant
    table.index(['status']);
    table.index(['scheduled_deletion_date']);
    table.index(['workflow_id']);
  });

  console.log('Created pending_tenant_deletions table');
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('pending_tenant_deletions');
  console.log('Dropped pending_tenant_deletions table');
};

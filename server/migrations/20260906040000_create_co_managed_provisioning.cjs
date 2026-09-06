const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  if (!await knex.schema.hasTable('co_managed_provisioning_operations')) {
    await knex.schema.createTable('co_managed_provisioning_operations', table => {
      table.uuid('tenant').notNullable(); // Sponsor owns the request, never customer credentials.
      table.uuid('operation_id').notNullable();
      table.uuid('allocation_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('requested_by').notNullable();
      table.uuid('escalation_board_id').notNullable(); // Sponsor-local destination.
      table.uuid('customer_board_id').notNullable(); // Pre-minted new default board.
      table.uuid('customer_client_id').notNullable(); // New customer's self-organization.
      table.uuid('administrator_invitation_id').notNullable(); // Token stays customer-owned.
      table.text('request_fingerprint').notNullable();
      table.jsonb('request').notNullable();
      table.text('state').notNullable().defaultTo('queued');
      table.text('step').nullable();
      table.text('error_code').nullable(); // Public-safe code; never raw database/provider errors.
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      table.unique(['tenant', 'customer_tenant']);
      table.check('tenant <> customer_tenant');
      table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
      table.check("state IN ('queued', 'provisioning', 'pending_acceptance', 'failed', 'cleanup_requested', 'cancelled')");
      table.check("step IS NULL OR step IN ('tenant', 'seeds', 'settings', 'administrator_invitation')");
    });
  }
  await ensureTenantDistribution(knex, 'co_managed_provisioning_operations');
};
exports.down = async function (knex) {
  if (await knex('co_managed_provisioning_operations').first()) throw new Error('Cannot roll back nonempty co-managed provisioning operations');
  await knex.schema.dropTable('co_managed_provisioning_operations');
};
exports.config = { transaction: false };

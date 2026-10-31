const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// Co-managed L3b1: idempotent command receipts. (tenant, operation_id) is the
// idempotency key; request_hash is the SHA-256 of actor + resource + command +
// request (never mutable state). Append-only in app code.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_command_receipts'))) {
    await knex.schema.createTable('co_management_command_receipts', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.uuid('relationship_id').notNullable();
      table.string('resource_type', 32).notNullable();
      table.uuid('resource_id').notNullable();
      table.uuid('actor_tenant').notNullable();
      table.uuid('actor_user_id').notNullable();
      table.string('command_type', 64).notNullable();
      table.string('request_hash', 64).notNullable();
      table.timestamp('applied_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      table.index(['tenant', 'relationship_id', 'resource_type', 'resource_id'], 'co_management_command_resource_idx');
      table.check("resource_type IN ('ticket', 'project', 'project_task')");
      table.check('char_length(command_type) > 0');
      table.check("request_hash ~ '^[0-9a-f]{64}$'");
    });
  }
  await ensureTenantDistribution(knex, 'co_management_command_receipts');
  await ensureCompositeFk(knex, { table: 'co_management_command_receipts', constraint: 'co_management_command_relationship_fk', columns: ['tenant', 'relationship_id'], referencedTable: 'co_management_relationships', referencedColumns: ['tenant', 'relationship_id'], onDelete: 'RESTRICT' });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_management_command_receipts'))) return;
  if (await knex('co_management_command_receipts').first()) {
    throw new Error('Cannot discard retained co-management command receipts');
  }
  await knex.schema.dropTable('co_management_command_receipts');
};

exports.config = { transaction: false };

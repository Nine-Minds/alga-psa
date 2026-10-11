const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_command_receipts';

exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('operation_id').notNullable();
    table.uuid('relationship_id').notNullable();
    table.string('resource_type', 32).notNullable();
    table.uuid('resource_id').notNullable();
    // Qualified historical identity; no source-tenant user FK or copied login.
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
  await ensureTenantDistribution(knex, TABLE);
  const name = 'co_management_command_relationship_fk';
  if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant', 'relationship_id'], name)
      .references(['tenant', 'relationship_id']).inTable('co_management_relationships'));
  }
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-management command receipts');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_private_command_receipts';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('operation_id').notNullable();
    // MSP-owned history: qualified soft source IDs survive customer separation.
    // No customer-owned receipt may reveal even the existence of a private note.
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable();
    table.string('resource_type', 32).notNullable(); table.uuid('resource_id').notNullable();
    table.uuid('actor_user_id').notNullable(); table.string('command_type', 32).notNullable();
    table.string('request_hash', 64).notNullable();
    table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.integer('revision').notNullable();
    table.timestamp('applied_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'operation_id']);
    table.index(['tenant', 'customer_tenant', 'relationship_id', 'resource_type', 'resource_id'], 'co_management_private_command_resource_idx');
    table.check('tenant <> customer_tenant');
    table.check("resource_type IN ('ticket', 'project_task')");
    table.check("command_type IN ('create', 'edit', 'delete')");
    table.check("request_hash ~ '^[0-9a-f]{64}$'"); table.check('revision > 0');
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained private command receipts');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

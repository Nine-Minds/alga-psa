const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  if (await knex.schema.hasTable('webhook_event_receipts')) return;
  await knex.schema.createTable('webhook_event_receipts', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('webhook_id').notNullable();
    table.uuid('event_id').notNullable();
    table.uuid('lease_token').notNullable();
    table.timestamp('lease_until', { useTz: true }).notNullable();
    table.boolean('delivered').notNullable().defaultTo(false);
    table.primary(['tenant', 'webhook_id', 'event_id']);
  });
  if ((await canCreateDistributedTable(knex)) && (await isDistributed(knex, 'webhooks'))) {
    await knex.raw("SELECT create_distributed_table('webhook_event_receipts', 'tenant', colocate_with => 'webhooks')");
  }
};
exports.down = async function (knex) { await knex.schema.dropTableIfExists('webhook_event_receipts'); };

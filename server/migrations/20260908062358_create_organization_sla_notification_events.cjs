const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'sla_organization_notification_events';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('notification_event_id').notNullable();
    table.uuid('obligation_id').notNullable();
    table.uuid('source_operation_id').notNullable();
    table.uuid('threshold_id').notNullable(); // Retained identity; deleting configuration must not delete history.
    table.integer('threshold_percent').notNullable();
    table.text('sla_type').notNullable();
    table.text('notification_type').notNullable();
    table.jsonb('configuration').notNullable();
    table.timestamp('due_at', { useTz: true });
    table.bigInteger('elapsed_milliseconds').notNullable();
    table.specificType('target_minutes', 'double precision').notNullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.timestamp('completed_at', { useTz: true });
    table.primary(['tenant', 'notification_event_id']);
    table.unique(['tenant', 'obligation_id', 'sla_type', 'threshold_percent']);
    table.index(['tenant', 'status', 'occurred_at']);
    table.check("sla_type IN ('response', 'resolution') AND notification_type IN ('warning', 'breach')");
    table.check("status IN ('pending', 'completed', 'skipped')");
    table.check('threshold_percent > 0 AND target_minutes >= 0 AND elapsed_milliseconds >= 0');
  });
  await ensureTenantDistribution(knex, TABLE);
  const name = 'sla_org_notification_source_fk';
  if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant', 'obligation_id', 'source_operation_id'], name)
      .references(['tenant', 'obligation_id', 'operation_id']).inTable('sla_organization_events').onDelete('CASCADE'));
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot remove retained organization SLA notifications');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };

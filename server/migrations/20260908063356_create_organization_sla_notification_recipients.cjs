const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'sla_organization_notification_recipients';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('notification_event_id').notNullable();
    table.uuid('recipient_user_id').notNullable();
    table.text('channel').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.uuid('notification_id');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.primary(['tenant', 'notification_event_id', 'recipient_user_id', 'channel']);
    table.unique(['tenant', 'notification_id']);
    table.check("channel IN ('in_app', 'email') AND status IN ('pending', 'created', 'disabled', 'delivered', 'skipped')");
    table.check("(status = 'created' AND channel = 'in_app' AND notification_id IS NOT NULL) OR (status <> 'created' AND notification_id IS NULL)");
    table.check("(status = 'pending' AND completed_at IS NULL) OR (status <> 'pending' AND completed_at IS NOT NULL)");
    table.index(['tenant', 'channel', 'status', 'created_at']);
  });
  await ensureTenantDistribution(knex, TABLE);
  const name = 'sla_org_notification_recipient_event_fk';
  if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant', 'notification_event_id'], name)
      .references(['tenant', 'notification_event_id']).inTable('sla_organization_notification_events').onDelete('CASCADE'));
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot remove retained organization SLA notification recipients');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };

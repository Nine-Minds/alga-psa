// Tenant notification policy: start every ticket "Don't notify the customer"
// checkbox ticked. Lives beside is_enabled because it governs outbound customer
// notifications, not ticket display. A constant default keeps the ADD COLUMN
// metadata-only on Postgres 11+ and Citus propagates it to every shard.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('notification_settings'))) return;
  if (await knex.schema.hasColumn('notification_settings', 'default_dont_notify_customer')) return;
  await knex.schema.alterTable('notification_settings', (table) => {
    table.boolean('default_dont_notify_customer').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('notification_settings'))) return;
  if (!(await knex.schema.hasColumn('notification_settings', 'default_dont_notify_customer'))) return;
  await knex.schema.alterTable('notification_settings', (table) => {
    table.dropColumn('default_dont_notify_customer');
  });
};
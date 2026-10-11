const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_notification_deliveries';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('notification_id').notNullable(); table.uuid('recipient_user_id').notNullable();
    table.string('channel', 16).notNullable(); table.string('status', 24).notNullable().defaultTo('pending');
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).nullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable(); table.string('last_error_code', 100).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'notification_id', 'channel']);
    table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_notification_delivery_due_idx');
    table.check("channel IN ('in_app', 'teams', 'push')");
    table.check('attempt_count >= 0');
    table.check("(status = 'pending' AND next_attempt_at IS NOT NULL AND completed_at IS NULL) OR (status IN ('delivered', 'skipped', 'failed') AND next_attempt_at IS NULL AND completed_at IS NOT NULL)");
    // Soft references keep attempt evidence when a recipient deletes an inbox item.
  });
  await ensureTenantDistribution(knex, TABLE);
  // Older committed receipts may have lost their immediate after-commit effect.
  // Replays reuse the notification ID, and current delivery authority is checked.
  for (const channel of ['in_app', 'teams', 'push']) await knex.raw(`
    INSERT INTO ?? (tenant, notification_id, recipient_user_id, channel)
    SELECT tenant, notification_id, recipient_user_id, ? FROM co_management_in_app_receipts
    WHERE outcome = 'created' AND notification_id IS NOT NULL
    ON CONFLICT (tenant, notification_id, channel) DO NOTHING`, [TABLE, channel]);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed notification deliveries');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

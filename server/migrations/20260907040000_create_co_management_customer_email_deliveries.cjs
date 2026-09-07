const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_customer_email_deliveries';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.string('delivery_key', 300).notNullable(); table.uuid('recipient_user_id').notNullable();
    table.uuid('event_id').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('comment_id').notNullable(); table.uuid('thread_id').notNullable();
    table.string('audience', 24).notNullable(); table.string('status', 16).notNullable().defaultTo('pending');
    table.integer('attempt_count').notNullable().defaultTo(0); table.timestamp('next_attempt_at', { useTz: true }).nullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable(); table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); table.string('error_code', 100).nullable();
    table.primary(['tenant', 'delivery_key']); table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_customer_email_due_idx');
    table.check("audience IN ('requester', 'shared_it', 'organization_private') AND attempt_count >= 0");
    table.check("(status = 'pending' AND next_attempt_at IS NOT NULL AND completed_at IS NULL) OR (status IN ('delivered', 'skipped', 'failed') AND next_attempt_at IS NULL AND completed_at IS NOT NULL)");
    // Owner-local soft references retain completion history after source/user deletion.
  });
  await ensureTenantDistribution(knex, TABLE);
  await knex.raw('ALTER TABLE co_management_event_consumers DROP CONSTRAINT IF EXISTS co_management_event_consumers_check');
  await knex.raw('ALTER TABLE co_management_event_consumers DROP CONSTRAINT IF EXISTS co_management_event_consumers_consumer_check');
  await knex.raw("ALTER TABLE co_management_event_consumers ADD CONSTRAINT co_management_event_consumers_consumer_check CHECK (consumer IN ('search-index', 'internal-notifications', 'co-managed-email', 'customer-internal-email') AND attempts >= 0)");
  // Published pre-rollout events belonged to the native sender. Do not replay
  // historical customer email through the new worker. A retained marker leaves
  // these events on the existing native sender, including an undelivered Redis event.
  await knex.raw(`INSERT INTO co_management_event_consumers (tenant, event_id, consumer, status, completed_at, error_code)
    SELECT tenant, event_id, 'customer-internal-email', CASE WHEN status = 'pending' THEN 'pending' ELSE 'cancelled' END,
      CASE WHEN status = 'pending' THEN NULL ELSE clock_timestamp() END,
      CASE WHEN status = 'pending' THEN NULL ELSE 'legacy_native_delivery' END
    FROM co_management_event_outbox WHERE event_type = 'TICKET_COMMENT_ADDED' ON CONFLICT DO NOTHING`);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first() || await knex('co_management_event_consumers').where('consumer', 'customer-internal-email').first()) throw new Error('Cannot discard retained customer email delivery history');
  await knex.raw('ALTER TABLE co_management_event_consumers DROP CONSTRAINT co_management_event_consumers_consumer_check');
  await knex.raw("ALTER TABLE co_management_event_consumers ADD CONSTRAINT co_management_event_consumers_consumer_check CHECK (consumer IN ('search-index', 'internal-notifications', 'co-managed-email') AND attempts >= 0)");
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };

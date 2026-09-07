exports.up = async function (knex) {
  const existing = await knex.raw("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'co_management_event_consumers'::regclass AND conname = 'co_management_event_consumers_consumer_check'");
  if (!existing.rows[0]?.definition.includes("'requester-email'")) {
    await knex.raw('ALTER TABLE co_management_event_consumers DROP CONSTRAINT IF EXISTS co_management_event_consumers_consumer_check');
    await knex.raw("ALTER TABLE co_management_event_consumers ADD CONSTRAINT co_management_event_consumers_consumer_check CHECK (consumer IN ('search-index', 'internal-notifications', 'co-managed-email', 'customer-internal-email', 'requester-email') AND attempts >= 0)");
  }
  // Retain ownership of published pre-rollout mail on the native sender. Pending
  // outbox events may enroll in the durable requester path without historical mail.
  await knex.raw(`INSERT INTO co_management_event_consumers (tenant, event_id, consumer, status, completed_at, error_code)
    SELECT tenant, event_id, 'requester-email', CASE WHEN status = 'pending' THEN 'pending' ELSE 'cancelled' END,
      CASE WHEN status = 'pending' THEN NULL ELSE clock_timestamp() END,
      CASE WHEN status = 'pending' THEN NULL ELSE 'legacy_native_delivery' END
    FROM co_management_event_outbox WHERE event_type = 'TICKET_COMMENT_ADDED' ON CONFLICT DO NOTHING`);
};
exports.down = async function (knex) {
  if (await knex('co_management_event_consumers').where('consumer', 'requester-email').first()) throw new Error('Cannot discard retained requester email consumer history');
  await knex.raw('ALTER TABLE co_management_event_consumers DROP CONSTRAINT co_management_event_consumers_consumer_check');
  await knex.raw("ALTER TABLE co_management_event_consumers ADD CONSTRAINT co_management_event_consumers_consumer_check CHECK (consumer IN ('search-index', 'internal-notifications', 'co-managed-email', 'customer-internal-email') AND attempts >= 0)");
};
exports.config = { transaction: false };

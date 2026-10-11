const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_event_consumers';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('event_id').notNullable(); table.string('consumer', 64).notNullable();
    table.string('status', 16).notNullable().defaultTo('pending'); table.integer('attempts').notNullable().defaultTo(0);
    table.string('error_code', 64).nullable(); table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.raw("now() + interval '2 minutes'"));
    table.primary(['tenant', 'event_id', 'consumer']); table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_event_consumers_due_idx');
    table.foreign(['tenant', 'event_id']).references(['tenant', 'event_id']).inTable('co_management_event_outbox').onDelete('RESTRICT');
    table.check("consumer IN ('search-index', 'internal-notifications') AND attempts >= 0");
    table.check("(status = 'pending' AND completed_at IS NULL) OR (status IN ('completed', 'cancelled') AND completed_at IS NOT NULL)");
  });
  await ensureTenantDistribution(knex, TABLE);
  // Retained events predating this migration also receive a recoverable obligation.
  for (const [consumer, types] of [['search-index', ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED']], ['internal-notifications', ['TICKET_COMMENT_ADDED']]]) {
    await knex.raw(`INSERT INTO ?? (tenant, event_id, consumer) SELECT tenant, event_id, ? FROM co_management_event_outbox WHERE event_type = ANY(?::text[]) ON CONFLICT DO NOTHING`, [TABLE, consumer, types]);
  }
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed consumer completion history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };

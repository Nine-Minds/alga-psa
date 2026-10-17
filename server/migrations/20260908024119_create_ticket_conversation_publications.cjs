const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_publications';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable();
    t.uuid('conversation_id').notNullable(); t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable();
    t.uuid('actor_tenant').notNullable(); t.uuid('actor_user_id').notNullable();
    t.string('request_hash', 64).notNullable(); t.string('mode', 16).notNullable();
    t.uuid('thread_id').notNullable(); t.uuid('comment_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'operation_id']);
    t.foreign(['tenant', 'conversation_id', 'ticket_id']).references(['tenant', 'conversation_id', 'ticket_id']).inTable('ticket_conversations');
    t.check("mode IN ('post', 'send') AND request_hash ~ '^[0-9a-f]{64}$'");
    t.index(['tenant', 'conversation_id', 'created_at']);
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation publication receipts');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

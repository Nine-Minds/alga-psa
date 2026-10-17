const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const EVENTS = 'ticket_conversation_message_events';
const PREFS = 'ticket_conversation_preferences';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('ticket_conversations', 'attention_version')) await knex.schema.alterTable('ticket_conversations', table => {
    table.bigInteger('attention_version').notNullable().defaultTo(0);
    table.check('attention_version >= 0', [], 'ticket_conversations_attention_nonnegative');
  });
  if (!await knex.schema.hasTable(EVENTS)) await knex.schema.createTable(EVENTS, table => {
    table.uuid('tenant').notNullable(); table.uuid('conversation_id').notNullable();
    table.uuid('ticket_tenant').notNullable(); table.uuid('ticket_id').notNullable();
    table.uuid('comment_id').notNullable(); table.uuid('thread_id').notNullable();
    table.bigInteger('sequence').notNullable(); table.string('kind', 16).notNullable();
    table.uuid('author_tenant').nullable(); table.uuid('author_user_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'conversation_id', 'comment_id']);
    table.unique(['tenant', 'conversation_id', 'sequence']);
    table.foreign(['tenant', 'conversation_id']).references(['tenant', 'conversation_id']).inTable('ticket_conversations');
    table.check('sequence > 0'); table.check("kind IN ('human', 'external')");
    table.check('(author_tenant IS NULL) = (author_user_id IS NULL)');
    table.check("(kind = 'human') = (author_user_id IS NOT NULL)");
  });
  await ensureTenantDistribution(knex, EVENTS);
  if (!await knex.schema.hasTable(PREFS)) await knex.schema.createTable(PREFS, table => {
    table.uuid('tenant').notNullable(); table.uuid('conversation_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.boolean('following').notNullable().defaultTo(false);
    table.bigInteger('last_read_version').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'conversation_id', 'actor_tenant', 'actor_user_id']);
    table.foreign(['tenant', 'conversation_id']).references(['tenant', 'conversation_id']).inTable('ticket_conversations');
    table.index(['tenant', 'actor_tenant', 'actor_user_id']); table.check('last_read_version >= 0');
  });
  await ensureTenantDistribution(knex, PREFS);
};
exports.down = async function (knex) {
  for (const name of [EVENTS, PREFS]) if (await knex.schema.hasTable(name) && await knex(name).first()) throw new Error('Retained conversation attention prevents rollback');
  await knex.schema.dropTableIfExists(PREFS); await knex.schema.dropTableIfExists(EVENTS);
  if (await knex.schema.hasColumn('ticket_conversations', 'attention_version')) await knex.schema.alterTable('ticket_conversations', table => table.dropColumn('attention_version'));
};

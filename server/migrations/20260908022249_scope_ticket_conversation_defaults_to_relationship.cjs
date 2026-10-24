/** A new relationship must get a new private default rather than reusing the
 * prior relationship's retained history. Canonical defaults remain ticket-wide. */
exports.up = async function (knex) {
  await knex.transaction(async trx => {
    await trx.raw('ALTER TABLE ticket_conversations DROP CONSTRAINT IF EXISTS ticket_conversations_default_unique');
    await trx.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ticket_conversations_native_default_unique
      ON ticket_conversations (tenant, ticket_tenant, ticket_id, default_slot) WHERE relationship_id IS NULL`);
    await trx.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ticket_conversations_relationship_default_unique
      ON ticket_conversations (tenant, ticket_tenant, ticket_id, relationship_id, default_slot) WHERE relationship_id IS NOT NULL`);
    // Replay also assigns older roots left unassigned by the original uniqueness
    // rule when multiple retained relationships referenced the same ticket.
    await require('./20260908013607_create_named_ticket_conversations.cjs').up(trx);
  });
};
exports.down = async function (knex) {
  await knex.transaction(async trx => {
    const duplicates = await trx('ticket_conversations').whereNotNull('default_slot')
      .groupBy('tenant', 'ticket_tenant', 'ticket_id', 'default_slot').havingRaw('count(*) > 1').first('tenant');
    if (duplicates) throw new Error('Cannot collapse retained relationship-specific conversation defaults');
    if (!await trx('pg_constraint').where({ conname: 'ticket_conversations_default_unique' })
      .whereRaw('conrelid = ?::regclass', ['ticket_conversations']).first()) {
      await trx.raw(`ALTER TABLE ticket_conversations ADD CONSTRAINT ticket_conversations_default_unique
        UNIQUE (tenant, ticket_tenant, ticket_id, default_slot)`);
    }
    await trx.raw('DROP INDEX IF EXISTS ticket_conversations_native_default_unique');
    await trx.raw('DROP INDEX IF EXISTS ticket_conversations_relationship_default_unique');
  });
};
exports.config = { transaction: false };

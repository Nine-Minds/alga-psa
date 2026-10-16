const TABLE = 'co_managed_participation_evidence';
async function sources(knex, conversation) {
  if (conversation) {
    const current = await knex('pg_constraint').whereRaw('conrelid = ?::regclass', [TABLE]).where('conname', 'co_participation_evidence_source_type_check')
      .first(knex.raw('pg_get_constraintdef(oid) AS definition'));
    if (current?.definition.includes("'conversation'")) return; // Preserve later source expansions on replay.
  }
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_participation_evidence_source_type_check', [TABLE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_participation_evidence_source_type_check CHECK (source_type IN ('ticket_handoff', 'work_audit', 'time_entry'${conversation ? ", 'conversation'" : ''}))`, [TABLE]);
}
exports.up = async knex => {
  if (!await knex.schema.hasColumn(TABLE, 'actor_kind')) await knex.schema.alterTable(TABLE, table => {
    table.text('actor_kind').notNullable().defaultTo('user');
    table.uuid('actor_contact_id').nullable();
  });
  await knex.raw('ALTER TABLE ?? ALTER COLUMN actor_user_id DROP NOT NULL', [TABLE]);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_participation_evidence_actor_kind_check', [TABLE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_participation_evidence_actor_kind_check CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL AND actor_contact_id IS NULL) OR
    (actor_kind = 'contact' AND actor_user_id IS NULL AND actor_contact_id IS NOT NULL) OR
    (actor_kind IN ('system', 'unknown') AND actor_user_id IS NULL AND actor_contact_id IS NULL))`, [TABLE]);
  await sources(knex, true);
};
exports.down = async knex => {
  if (await knex(TABLE).where('source_type', 'conversation').orWhereNot('actor_kind', 'user').first()) throw new Error('Cannot remove retained conversation participation evidence');
  await sources(knex, false);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT co_participation_evidence_actor_kind_check', [TABLE]);
  await knex.raw('ALTER TABLE ?? ALTER COLUMN actor_user_id SET NOT NULL', [TABLE]);
  await knex.schema.alterTable(TABLE, table => { table.dropColumn('actor_kind'); table.dropColumn('actor_contact_id'); });
};

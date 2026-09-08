const TABLE = 'co_managed_participation_evidence';
async function constraint(knex, values) {
  const rows = await knex('pg_constraint').where({ contype: 'c' }).whereRaw('conrelid = ?::regclass', [TABLE])
    .whereRaw("pg_get_constraintdef(oid) LIKE '%source_type%'").select('conname');
  for (const row of rows) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, row.conname]);
  const literals = values.map(value => knex.raw('?', [value]).toQuery()).join(', ');
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_participation_evidence_source_type_check CHECK (source_type IN (${literals}))`, [TABLE]);
}
exports.up = async knex => constraint(knex, ['ticket_handoff', 'work_audit', 'time_entry']);
exports.down = async knex => {
  if (await knex(TABLE).where('source_type', 'time_entry').first()) throw new Error('Cannot remove retained time participation evidence');
  await constraint(knex, ['ticket_handoff', 'work_audit']);
};

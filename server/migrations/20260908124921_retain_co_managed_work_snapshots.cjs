const TABLE = 'co_managed_participation_evidence';
async function sources(knex, snapshots) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT co_participation_evidence_source_type_check', [TABLE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_participation_evidence_source_type_check CHECK (source_type IN ('ticket_handoff', 'work_audit', 'time_entry', 'conversation', 'private_conversation'${snapshots ? ", 'work_snapshot'" : ''}))`, [TABLE]);
}
exports.up = knex => sources(knex, true);
exports.down = async knex => {
  if (await knex(TABLE).where('source_type', 'work_snapshot').first()) throw new Error('Cannot remove retained shared work snapshots');
  await sources(knex, false);
};

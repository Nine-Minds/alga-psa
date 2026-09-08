const EVIDENCE = 'co_managed_participation_evidence', FILES = 'co_managed_archive_files';
async function evidenceSources(knex, privateHistory) {
  if (privateHistory) {
    const current = await knex('pg_constraint').whereRaw('conrelid = ?::regclass', [EVIDENCE]).where('conname', 'co_participation_evidence_source_type_check')
      .first(knex.raw('pg_get_constraintdef(oid) AS definition'));
    if (current?.definition.includes("'private_conversation'")) return; // Preserve later source expansions on replay.
  }
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT co_participation_evidence_source_type_check', [EVIDENCE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_participation_evidence_source_type_check CHECK (source_type IN ('ticket_handoff', 'work_audit', 'time_entry', 'conversation'${privateHistory ? ", 'private_conversation'" : ''}))`, [EVIDENCE]);
}
async function fileSources(knex, privateHistory) {
  const constraints = await knex('pg_constraint').where({ contype: 'c' }).whereRaw('conrelid = ?::regclass', [FILES])
    .whereRaw("pg_get_constraintdef(oid) LIKE '%source_tenant%'").select('conname');
  for (const row of constraints) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [FILES, row.conname]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_archive_file_audience_check CHECK (tenant <> customer_tenant AND (
    (source_tenant = customer_tenant AND audience IN ('requester', 'shared_it'))${privateHistory ? " OR (source_tenant = tenant AND audience = 'organization_private')" : ''}))`, [FILES]);
}
exports.up = async knex => { await evidenceSources(knex, true); await fileSources(knex, true); };
exports.down = async knex => {
  if (await knex(EVIDENCE).where('source_type', 'private_conversation').first() || await knex(FILES).where('audience', 'organization_private').first()) throw new Error('Cannot remove retained MSP-private history');
  await evidenceSources(knex, false); await fileSources(knex, false);
};

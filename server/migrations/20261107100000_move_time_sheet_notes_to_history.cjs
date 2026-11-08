'use strict';
const { createHash } = require('node:crypto');

// Mainline's 20261028135300 migration added a free-form notes column. Preserve any values
// as submission history, while retaining the column for N-1 application compatibility.
// Read/write in bounded batches so this also works when the two tables have different
// Citus distribution states.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  // Legacy notes have no reliable workflow kind, author, or creation timestamp.
  // Preserve them as `legacy`; null created_by makes the missing provenance explicit.
  if (await knex.schema.hasTable('time_sheet_notes')) {
    await knex.raw(`ALTER TABLE time_sheet_notes DROP CONSTRAINT IF EXISTS time_sheet_notes_kind_check`);
    await knex.raw(`ALTER TABLE time_sheet_notes ADD CONSTRAINT time_sheet_notes_kind_check CHECK (kind IN ('submission', 'approval', 'request_changes', 'reverse_approval', 'legacy')) NOT VALID`);
    await knex.raw(`ALTER TABLE time_sheet_notes ALTER COLUMN created_by DROP NOT NULL`);
  }
  if (!(await knex.schema.hasColumn('time_sheets', 'notes'))) return;
  if (!(await knex.schema.hasTable('time_sheet_notes'))) {
    throw new Error('time_sheet_notes must exist before time_sheets.notes can be retired');
  }

  let last = null;
  while (true) {
    const query = knex('time_sheets')
      .select('tenant', 'id', 'user_id', 'notes')
      .whereNotNull('notes')
      .orderBy('tenant')
      .orderBy('id')
      .limit(500);
    if (last) query.whereRaw('(tenant, id) > (?, ?)', [last.tenant, last.id]);
    const rows = await query;
    if (rows.length === 0) break;

    for (const row of rows) {
      // Earlier versions used a sheet-only ID. Recognize those records too, while
      // retaining a new version if the legacy application edited notes after rollback.
      const retained = await knex('time_sheet_notes').where({
        tenant: row.tenant, time_sheet_id: row.id, kind: 'legacy', note: row.notes,
      }).first('note_id');
      if (retained) continue;
      const digest = createHash('sha256').update(JSON.stringify([row.tenant, row.id, 'legacy-notes', row.notes])).digest('hex');
      const variant = ((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
      const noteId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      await knex('time_sheet_notes').insert({
        tenant: row.tenant,
        time_sheet_id: row.id,
        // Stable ID makes retrying this non-transactional migration idempotent.
        note_id: noteId,
        kind: 'legacy',
        note: row.notes,
        detail: 'Migrated from time_sheets.notes; original kind, author, and creation time were not recorded.',
        created_by: null,
        created_at: knex.fn.now(),
      }).onConflict(['tenant', 'note_id']).ignore();
    }
    last = rows[rows.length - 1];
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('time_sheets', 'notes'))) {
    await knex.schema.alterTable('time_sheets', (table) => table.text('notes').nullable());
  }
  if (!(await knex.schema.hasTable('time_sheet_notes'))) return;

  // Keep history intact. Restore the latest legacy value, never workflow notes,
  // and do not overwrite edits if this non-transactional rollback is retried.
  let last = null;
  while (true) {
    const query = knex('time_sheets').select('tenant', 'id').whereNull('notes')
      .orderBy('tenant').orderBy('id').limit(500);
    if (last) query.whereRaw('(tenant, id) > (?, ?)', [last.tenant, last.id]);
    const rows = await query;
    if (rows.length === 0) break;
    for (const row of rows) {
      const legacy = await knex('time_sheet_notes')
        .where({ tenant: row.tenant, time_sheet_id: row.id, kind: 'legacy' })
        .orderBy('created_at', 'desc').orderBy('note_id', 'desc').first('note');
      if (legacy) {
        await knex('time_sheets').where({ tenant: row.tenant, id: row.id })
          .whereNull('notes').update({ notes: legacy.note });
      }
    }
    last = rows[rows.length - 1];
  }
};

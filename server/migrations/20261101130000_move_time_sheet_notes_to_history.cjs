'use strict';
const { createHash } = require('node:crypto');

// Keep the approved time_sheets schema limited to its lifecycle columns. Mainline's
// 20261028135300 migration briefly added a free-form notes column; preserve any values
// as submission history before removing it. Read/write in bounded batches so this also
// works when the two tables have different Citus distribution states.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  // Legacy notes have no reliable workflow kind, author, or creation timestamp.
  // Preserve them as `legacy`; null created_by makes the missing provenance explicit.
  if (await knex.schema.hasTable('time_sheet_notes')) {
    await knex.raw(`ALTER TABLE time_sheet_notes DROP CONSTRAINT IF EXISTS time_sheet_notes_kind_check`);
    await knex.raw(`ALTER TABLE time_sheet_notes ADD CONSTRAINT time_sheet_notes_kind_check CHECK (kind IN ('submission', 'approval', 'request_changes', 'reverse_approval', 'legacy'))`);
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
      await knex('time_sheet_notes').insert({
        tenant: row.tenant,
        time_sheet_id: row.id,
        // Stable ID makes retrying this non-transactional migration idempotent.
        note_id: createHash('sha256').update(`${row.tenant}:${row.id}:legacy-notes`).digest('hex').slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-4$3-a$4-$5'),
        kind: 'legacy',
        note: row.notes,
        detail: 'Migrated from time_sheets.notes; original kind, author, and creation time were not recorded.',
        created_by: null,
        created_at: knex.fn.now(),
      }).onConflict(['tenant', 'note_id']).ignore();
    }
    last = rows[rows.length - 1];
  }

  await knex.schema.alterTable('time_sheets', (table) => table.dropColumn('notes'));
};

exports.down = async function down() {
  throw new Error('Cannot restore time_sheets.notes after migrating values into append-only history');
};

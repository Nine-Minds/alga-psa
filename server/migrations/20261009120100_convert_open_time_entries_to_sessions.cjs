/**
 * Convert open time entries (end_time IS NULL) into stopwatch sessions (2026-10-10).
 *
 * Before the stopwatch tables existed the mobile app kept its timer as a time_entries row with a NULL
 * end_time. Every such row becomes a time_tracking_sessions row (session_id = the old entry_id, so
 * installed mobile builds that hold that id keep working through the legacy adapters) with one open
 * segment starting at the row's start_time; the time_entries row is then deleted.
 *
 * Only one open session per user is allowed (unique index). A user with several open rows
 * (possible only through the old unguarded check-then-insert race) keeps the NEWEST as `running`;
 * older ones are stored as `discarded` sessions with a zero-length closed segment, so the notes and
 * start survive for forensics but no phantom elapsed time is invented.
 *
 * Idempotent: a second run finds no open rows. Parameterised values only (Citus UPDATE rule).
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('time_tracking_sessions'))) {
    throw new Error('time_tracking_sessions must exist before converting open time entries');
  }

  const openRows = await knex('time_entries')
    .whereNull('end_time')
    .select('tenant', 'entry_id', 'user_id', 'work_item_type', 'work_item_id', 'service_id', 'notes', 'start_time', 'created_at')
    .orderBy([
      { column: 'tenant' },
      { column: 'user_id' },
      { column: 'start_time', order: 'desc' },
      { column: 'created_at', order: 'desc' },
      { column: 'entry_id' },
    ]);

  if (openRows.length === 0) {
    console.log('[convert_open_time_entries_to_sessions] no open time entries to convert');
    return;
  }

  let running = 0;
  let discarded = 0;
  const seenUsers = new Set();

  for (const row of openRows) {
    const userKey = `${row.tenant}:${row.user_id}`;
    const isNewestForUser = !seenUsers.has(userKey);
    seenUsers.add(userKey);

    await knex.transaction(async (trx) => {
      const alreadyConverted = await trx('time_tracking_sessions')
        .where({ tenant: row.tenant, session_id: row.entry_id })
        .first('session_id');

      if (!alreadyConverted) {
        // A pre-existing open session (e.g. started on the new code during a rolling deploy) wins:
        // the legacy row is then discarded instead of running.
        const existingOpen = isNewestForUser
          ? await trx('time_tracking_sessions')
              .where({ tenant: row.tenant, user_id: row.user_id })
              .whereIn('status', ['running', 'paused'])
              .first('session_id')
          : null;
        const asRunning = isNewestForUser && !existingOpen;

        await trx('time_tracking_sessions').insert({
          tenant: row.tenant,
          session_id: row.entry_id,
          user_id: row.user_id,
          work_item_type: row.work_item_type,
          work_item_id: row.work_item_id ?? null,
          service_id: row.service_id ?? null,
          notes: row.notes ?? '',
          status: asRunning ? 'running' : 'discarded',
          closed_at: asRunning ? null : trx.fn.now(),
          created_at: row.created_at ?? row.start_time,
          updated_at: trx.fn.now(),
        });
        await trx('time_tracking_session_segments').insert({
          tenant: row.tenant,
          session_id: row.entry_id,
          started_at: row.start_time,
          ended_at: asRunning ? null : row.start_time,
        });
        if (asRunning) running += 1;
        else discarded += 1;
      }

      await trx('time_entries').where({ tenant: row.tenant, entry_id: row.entry_id }).whereNull('end_time').del();
    });
  }

  console.log(
    `[convert_open_time_entries_to_sessions] converted ${openRows.length} open time entries ` +
      `(${running} running, ${discarded} discarded duplicates)`,
  );
};

exports.down = async function () {
  // Irreversible by design: sessions are not turned back into open time entries.
};

const ONLINE_MEETING_STATUSES = [
  'scheduled',
  'ended',
  'recording_pending',
  'recording_ready',
  'no_recording',
  'cancel_pending',
  'cancelled',
  'failed',
];

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('online_meetings');
  if (!hasTable) {
    return;
  }

  if (!(await knex.schema.hasColumn('online_meetings', 'error_code'))) {
    await knex.schema.alterTable('online_meetings', (table) => {
      table.text('error_code').nullable();
    });
  }

  // Failed creations persist a row without a Graph meeting/join URL, so both
  // columns become nullable (the unique constraint tolerates NULLs).
  await knex.raw(`ALTER TABLE online_meetings ALTER COLUMN provider_meeting_id DROP NOT NULL;`);
  await knex.raw(`ALTER TABLE online_meetings ALTER COLUMN join_url DROP NOT NULL;`);

  await knex.raw(`ALTER TABLE online_meetings DROP CONSTRAINT IF EXISTS online_meetings_status_check;`);
  await knex.raw(`
    ALTER TABLE online_meetings ADD CONSTRAINT online_meetings_status_check
    CHECK (status IN (${ONLINE_MEETING_STATUSES.map((status) => `'${status}'`).join(', ')}));
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('online_meetings');
  if (!hasTable) {
    return;
  }

  await knex.raw(`DELETE FROM online_meetings WHERE status = 'cancel_pending' OR provider_meeting_id IS NULL;`);
  await knex.raw(`ALTER TABLE online_meetings DROP CONSTRAINT IF EXISTS online_meetings_status_check;`);
  await knex.raw(`
    ALTER TABLE online_meetings ADD CONSTRAINT online_meetings_status_check
    CHECK (status IN (${ONLINE_MEETING_STATUSES.filter((status) => status !== 'cancel_pending')
      .map((status) => `'${status}'`)
      .join(', ')}));
  `);

  if (await knex.schema.hasColumn('online_meetings', 'error_code')) {
    await knex.schema.alterTable('online_meetings', (table) => {
      table.dropColumn('error_code');
    });
  }
};

exports.config = { transaction: false };

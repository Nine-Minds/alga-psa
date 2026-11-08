// CM L6a1 (1 of 2 for time_entries.billing_mode): expand-only.
// ADD COLUMN ... NOT NULL DEFAULT is metadata-only, so N-1 writers that never
// name the column keep inserting 'commercial'. No backfill, no triggers, no
// tenant-wide probes. The CHECK is added NOT VALID (no scan, no long lock);
// 20261028135100 validates it outside a transaction.
const CHECK = 'time_entries_billing_mode_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('time_entries'))) return;
  if (!(await knex.schema.hasColumn('time_entries', 'billing_mode'))) {
    await knex.raw(`ALTER TABLE time_entries ADD COLUMN billing_mode text NOT NULL DEFAULT 'commercial'`);
  }
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${CHECK}' AND conrelid = 'time_entries'::regclass) THEN
        ALTER TABLE time_entries ADD CONSTRAINT ${CHECK}
          CHECK (billing_mode IN ('commercial', 'operational')) NOT VALID;
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('time_entries'))) return;
  await knex.raw(`ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS ${CHECK}`);
  if (await knex.schema.hasColumn('time_entries', 'billing_mode')) {
    const nonDefault = await knex('time_entries').whereNot('billing_mode', 'commercial').first('entry_id');
    if (nonDefault) throw new Error('Cannot drop time_entries.billing_mode while non-commercial entries exist');
    await knex.raw('ALTER TABLE time_entries DROP COLUMN billing_mode');
  }
};

/**
 * Make schedule_entries.scheduled_start / scheduled_end optional for ad-hoc entries.
 *
 * Ad-hoc entries behave like personal to-dos and may have no scheduled time.
 * A CHECK constraint still requires times for every other work_item_type so
 * real calendar entries can't be created without a time.
 *
 * schedule_entries is a Citus-distributed table; ALTER COLUMN / ADD CONSTRAINT
 * propagate to all shards automatically.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE schedule_entries ALTER COLUMN scheduled_start DROP NOT NULL;`);
  await knex.raw(`ALTER TABLE schedule_entries ALTER COLUMN scheduled_end DROP NOT NULL;`);

  await knex.raw(`ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_times_required_check;`);
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_times_required_check
    CHECK (
      work_item_type = 'ad_hoc'
      OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL)
    );
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_times_required_check;`);

  // Backfill any null times before restoring NOT NULL (e.g. time-less ad-hoc entries).
  await knex('schedule_entries').whereNull('scheduled_start').update({ scheduled_start: knex.fn.now() });
  await knex('schedule_entries').whereNull('scheduled_end').update({ scheduled_end: knex.fn.now() });

  await knex.raw(`ALTER TABLE schedule_entries ALTER COLUMN scheduled_start SET NOT NULL;`);
  await knex.raw(`ALTER TABLE schedule_entries ALTER COLUMN scheduled_end SET NOT NULL;`);
};

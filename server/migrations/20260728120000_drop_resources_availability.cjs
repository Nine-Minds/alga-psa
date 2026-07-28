/**
 * Drop the dead `resources.availability` column.
 *
 * The column is an unvalidated jsonb blob with no readers and exactly one
 * writer — the dev seed. It was never a work schedule: reusing it would
 * re-conflate "when is this person on the clock" (now `user_work_schedules`)
 * with "when may a client book them" (`availability_settings`), which is the
 * confusion that made the first cut of the utilization report divide by
 * bookable hours.
 *
 * Deliberately no archive table. Production holds a single `resources` row —
 * the seeded Oz test tenant's `glinda`, carrying the seed's own
 * `[{monday: true, ...}]` blob — so there is nothing to preserve, and an
 * archive would have to earn its own tenant-deletion entry and Citus placement
 * to hold it. Any rows found are logged verbatim below, which is recovery
 * enough for a column nothing reads.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('resources', 'availability'))) {
    console.log('[drop_resources_availability] Column already dropped; nothing to do.');
    return;
  }

  const captured = await knex.raw(`
    SELECT tenant, resource_id, user_id, availability
    FROM resources
    WHERE availability IS NOT NULL;
  `);
  const rows = captured.rows || [];
  console.log(
    `[drop_resources_availability] Dropping ${rows.length} non-null availability row(s); payloads follow.`
  );
  for (const row of rows) {
    console.log(`[drop_resources_availability] ${JSON.stringify(row)}`);
  }

  // Plain DDL: Citus propagates it to every shard, and without
  // create_distributed_table the default migration transaction is fine.
  await knex.raw(`ALTER TABLE resources DROP COLUMN availability;`);
  console.log('[drop_resources_availability] Column resources.availability dropped.');
};

/**
 * Restores the column but not its contents — see the note in `up`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('resources', 'availability'))) {
    await knex.raw(`ALTER TABLE resources ADD COLUMN availability jsonb;`);
  }
};

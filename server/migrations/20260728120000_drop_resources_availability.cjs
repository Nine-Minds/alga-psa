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
 * Anything found in the column is copied into a coordinator-local archive
 * table first, so the drop is reversible and the deploy log carries the
 * payload verbatim.
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
  console.log(`[drop_resources_availability] Archiving ${rows.length} non-null availability row(s).`);
  for (const row of rows) {
    console.log(`[drop_resources_availability] ${JSON.stringify(row)}`);
  }

  if (rows.length > 0) {
    // Cold storage for a dropped column, not a tenant workload table: it is
    // deliberately left undistributed and is not part of the Citus distribute
    // backlog. Operators may drop it after a bake period.
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS resources_availability_archive (
        tenant uuid NOT NULL,
        resource_id uuid NOT NULL,
        user_id uuid NOT NULL,
        availability jsonb NOT NULL,
        archived_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant, resource_id)
      );
    `);

    await knex.raw(`
      INSERT INTO resources_availability_archive (tenant, resource_id, user_id, availability)
      SELECT tenant, resource_id, user_id, availability
      FROM resources
      WHERE availability IS NOT NULL
      ON CONFLICT (tenant, resource_id) DO NOTHING;
    `);
    console.log('[drop_resources_availability] Archive populated.');
  }

  // Plain DDL: Citus propagates it to every shard, and without
  // create_distributed_table the default migration transaction is fine.
  await knex.raw(`ALTER TABLE resources DROP COLUMN availability;`);
  console.log('[drop_resources_availability] Column resources.availability dropped.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('resources', 'availability'))) {
    await knex.raw(`ALTER TABLE resources ADD COLUMN availability jsonb;`);
  }

  if (await knex.schema.hasTable('resources_availability_archive')) {
    // The archive is intentionally left in place: it is the only copy of the
    // payload if this rollback is itself rolled forward again.
    await knex.raw(`
      UPDATE resources r
      SET availability = a.availability
      FROM resources_availability_archive a
      WHERE r.tenant = a.tenant
        AND r.resource_id = a.resource_id;
    `);
  }
};

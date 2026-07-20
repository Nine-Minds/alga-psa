
exports.up = async function up(knex) {
  // On Citus, create_distributed_table() leaves the pre-distribution rows in the
  // coordinator's local heap. They are invisible to all Citus-planned queries
  // (including the dedupe UPDATEs below) but CREATE INDEX still scans them, so
  // stale duplicates fail the unique index build. Truncate the leftover local
  // data first.
  //
  // ⚠️ UNSAFE PATTERN — do not copy into new migrations.
  // truncate_local_data_after_distributing_table() issues a TRUNCATE that
  // CASCADEs across the whole FK graph. It is NOT harmless: while distributed
  // tables in the cascade only lose stranded coordinator-local rows (shard
  // data is untouched), any NON-distributed table in the recursive FK closure
  // loses ALL of its data — a local table's coordinator heap is its only copy.
  // Before ever calling this again, walk the FK closure (pg_constraint) and
  // abort unless every member is distributed (pg_dist_partition). Retained as
  // history, not as an example.
  const citusInstalled = await knex.raw(
    "SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus"
  );
  if (citusInstalled.rows[0].has_citus) {
    const distributed = await knex.raw(
      "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.client_locations'::regclass"
    );
    if (distributed.rows.length > 0) {
      await knex.raw(
        "SELECT truncate_local_data_after_distributing_table('public.client_locations')"
      );
    }
  }

  await knex.raw(`
    UPDATE client_locations
    SET is_default = false,
        updated_at = NOW()
    WHERE is_default = true
      AND is_active = false
  `);

  await knex.raw(`
    WITH ranked_defaults AS (
      SELECT tenant,
             location_id,
             ROW_NUMBER() OVER (
               PARTITION BY tenant, client_id
               ORDER BY (is_active IS TRUE) DESC,
                        updated_at DESC NULLS LAST,
                        created_at DESC NULLS LAST,
                        location_id DESC
             ) AS default_rank
      FROM client_locations
      WHERE is_default = true
    )
    UPDATE client_locations AS location
    SET is_default = false,
        updated_at = NOW()
    FROM ranked_defaults AS ranked
    WHERE location.tenant = ranked.tenant
      AND location.location_id = ranked.location_id
      AND ranked.default_rank > 1
  `);

  await knex.raw(`
    WITH ranked_active_locations AS (
      SELECT location.tenant,
             location.location_id,
             ROW_NUMBER() OVER (
               PARTITION BY location.tenant, location.client_id
               ORDER BY location.created_at ASC, location.location_id ASC
             ) AS active_rank
      FROM client_locations AS location
      WHERE location.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM client_locations AS existing_default
          WHERE existing_default.tenant = location.tenant
            AND existing_default.client_id = location.client_id
            AND existing_default.is_default = true
        )
    )
    UPDATE client_locations AS location
    SET is_default = true,
        updated_at = NOW()
    FROM ranked_active_locations AS ranked
    WHERE location.tenant = ranked.tenant
      AND location.location_id = ranked.location_id
      AND ranked.active_rank = 1
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX ux_client_locations_default_per_client
    ON client_locations (tenant, client_id)
    WHERE is_default = true
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS ux_client_locations_default_per_client');
};

exports.config = { transaction: true };

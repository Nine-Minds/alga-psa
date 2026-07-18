
exports.up = async function up(knex) {
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
               ORDER BY updated_at DESC, created_at DESC, location_id DESC
             ) AS default_rank
      FROM client_locations
      WHERE is_default = true
        AND is_active = true
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

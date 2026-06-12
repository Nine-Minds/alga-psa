/**
 * Adds a nullable client location reference to assets. Existing free-text
 * assets.location values are intentionally left untouched and location_id
 * remains null for historical rows.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('assets', (table) => {
    table.uuid('location_id').nullable();
  });

  let clientLocationsDistributed = false;
  let assetsDistributed = false;
  let hasCitus = false;

  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) as has_citus
    `);
    hasCitus = citusCheck.rows[0].has_citus;

    if (hasCitus) {
      try {
        const locResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'client_locations'::regclass
          ) as is_distributed
        `);
        clientLocationsDistributed = locResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking client_locations distribution:', error.message);
      }

      try {
        const assetsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'assets'::regclass
          ) as is_distributed
        `);
        assetsDistributed = assetsResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking assets distribution:', error.message);
      }
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with foreign key');
  }

  const compatibleForFk =
    !hasCitus ||
    (!clientLocationsDistributed && !assetsDistributed) ||
    (clientLocationsDistributed && assetsDistributed);

  if (compatibleForFk) {
    await knex.schema.alterTable('assets', (table) => {
      table
        .foreign(['location_id', 'tenant'])
        .references(['location_id', 'tenant'])
        .inTable('client_locations')
        .onDelete('RESTRICT');
    });
  } else {
    console.log('assets and client_locations have incompatible distribution - skipping foreign key');
  }

  await knex.schema.alterTable('assets', (table) => {
    table.index(['tenant', 'client_id', 'location_id'], 'idx_assets_tenant_client_location');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  let clientLocationsDistributed = false;
  let assetsDistributed = false;
  let hasCitus = false;
  let shouldDropForeignKey = true;

  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) as has_citus
    `);
    hasCitus = citusCheck.rows[0].has_citus;

    if (hasCitus) {
      try {
        const locResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'client_locations'::regclass
          ) as is_distributed
        `);
        clientLocationsDistributed = locResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore.
      }

      try {
        const assetsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'assets'::regclass
          ) as is_distributed
        `);
        assetsDistributed = assetsResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore.
      }

      shouldDropForeignKey =
        (!clientLocationsDistributed && !assetsDistributed) ||
        (clientLocationsDistributed && assetsDistributed);
    }
  } catch (error) {
    // pg_dist_partition doesn't exist: FK was created.
  }

  await knex.schema.alterTable('assets', (table) => {
    table.dropIndex(['tenant', 'client_id', 'location_id'], 'idx_assets_tenant_client_location');
    if (shouldDropForeignKey) {
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};

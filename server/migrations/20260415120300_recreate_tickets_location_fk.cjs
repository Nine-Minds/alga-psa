/**
 * Recreates the tickets.location_id -> client_locations FK that was
 * CASCADE-dropped when company_locations was dropped in
 * 20251003000004_company_to_client_cleanup.cjs. tickets.location_id has
 * existed as a bare column with an index since
 * 20250613190110_add_location_to_tickets.cjs. This migration re-adds the
 * composite FK against the current client_locations table, preserving the
 * RESTRICT delete policy intent.
 *
 * The existing idx_tickets_location_tenant index remains in place; we do not
 * recreate or drop it here.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // Skip if the FK already exists (defensive - environments may have recreated it manually).
  const existingConstraint = await knex.raw(`
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'tickets'
      AND c.contype = 'f'
      AND c.conname LIKE '%location%'
  `);
  if (existingConstraint.rows.length > 0) {
    console.log('tickets location FK appears to already exist - skipping');
    return;
  }

  let clientLocationsDistributed = false;
  let ticketsDistributed = false;
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
        const ticketsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'tickets'::regclass
          ) as is_distributed
        `);
        ticketsDistributed = ticketsResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking tickets distribution:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with foreign key');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with foreign key');
  }

  const compatibleForFk =
    !hasCitus ||
    (!clientLocationsDistributed && !ticketsDistributed) ||
    (clientLocationsDistributed && ticketsDistributed);

  if (compatibleForFk) {
    console.log(
      'tickets and client_locations are compatible for FK - adding foreign key constraint'
    );
    await knex.schema.alterTable('tickets', (table) => {
      table
        .foreign(['location_id', 'tenant'])
        .references(['location_id', 'tenant'])
        .inTable('client_locations')
        .onDelete('RESTRICT')
        .onUpdate('CASCADE');
    });
  } else {
    console.log(
      'tickets and client_locations have incompatible distribution - skipping foreign key'
    );
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  let clientLocationsDistributed = false;
  let ticketsDistributed = false;
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
        // Ignore
      }

      try {
        const ticketsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'tickets'::regclass
          ) as is_distributed
        `);
        ticketsDistributed = ticketsResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore
      }

      shouldDropForeignKey =
        (!clientLocationsDistributed && !ticketsDistributed) ||
        (clientLocationsDistributed && ticketsDistributed);
    }
  } catch (error) {
    // pg_dist_partition doesn't exist: FK was created.
  }

  if (shouldDropForeignKey) {
    await knex.schema.alterTable('tickets', (table) => {
      table.dropForeign(['location_id', 'tenant']);
    });
  }
};

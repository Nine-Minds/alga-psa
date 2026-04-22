/**
 * Adds location_id to quote_items so line items can be tagged per client location.
 * Follows the Citus-aware conditional FK pattern from
 * 20250613190110_add_location_to_tickets.cjs, but targets the current
 * client_locations table (company_locations was dropped in
 * 20251003000004_company_to_client_cleanup.cjs).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // Add the nullable column.
  await knex.schema.alterTable('quote_items', (table) => {
    table.uuid('location_id').nullable();
  });

  // Determine whether both sides have compatible Citus distribution.
  let clientLocationsDistributed = false;
  let quoteItemsDistributed = false;
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
        const itemsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'quote_items'::regclass
          ) as is_distributed
        `);
        quoteItemsDistributed = itemsResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking quote_items distribution:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with foreign key');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with foreign key');
  }

  const compatibleForFk =
    !hasCitus ||
    (!clientLocationsDistributed && !quoteItemsDistributed) ||
    (clientLocationsDistributed && quoteItemsDistributed);

  if (compatibleForFk) {
    console.log(
      'quote_items and client_locations are compatible for FK - adding foreign key constraint'
    );
    await knex.schema.alterTable('quote_items', (table) => {
      // ON UPDATE CASCADE is not supported by Citus when the distribution
      // key (tenant) is part of the FK, so we only set ON DELETE.
      table
        .foreign(['location_id', 'tenant'])
        .references(['location_id', 'tenant'])
        .inTable('client_locations')
        .onDelete('RESTRICT');
    });
  } else {
    console.log(
      'quote_items and client_locations have incompatible distribution - skipping foreign key, adding index only'
    );
  }

  await knex.schema.alterTable('quote_items', (table) => {
    table.index(['tenant', 'quote_id', 'location_id'], 'idx_quote_items_location');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // Mirror the guard used in up() so we only drop the FK if it was created.
  let clientLocationsDistributed = false;
  let quoteItemsDistributed = false;
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
        const itemsResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'quote_items'::regclass
          ) as is_distributed
        `);
        quoteItemsDistributed = itemsResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore
      }

      shouldDropForeignKey =
        (!clientLocationsDistributed && !quoteItemsDistributed) ||
        (clientLocationsDistributed && quoteItemsDistributed);
    }
  } catch (error) {
    // pg_dist_partition doesn't exist (not using Citus): FK was created.
  }

  await knex.schema.alterTable('quote_items', (table) => {
    table.dropIndex(['tenant', 'quote_id', 'location_id'], 'idx_quote_items_location');
    if (shouldDropForeignKey) {
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};

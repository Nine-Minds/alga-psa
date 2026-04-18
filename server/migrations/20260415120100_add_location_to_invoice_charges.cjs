/**
 * Adds location_id to invoice_charges so invoice line items can be tagged per
 * client location. Note: the table is invoice_charges (renamed from
 * invoice_items by 20251026120000_convert_invoice_and_transactions_currency.cjs,
 * which also left a compatibility view named invoice_items).
 *
 * Follows the Citus-aware conditional FK pattern from
 * 20250613190110_add_location_to_tickets.cjs.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('invoice_charges', (table) => {
    table.uuid('location_id').nullable();
  });

  let clientLocationsDistributed = false;
  let invoiceChargesDistributed = false;
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
        const chargesResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'invoice_charges'::regclass
          ) as is_distributed
        `);
        invoiceChargesDistributed = chargesResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking invoice_charges distribution:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with foreign key');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with foreign key');
  }

  const compatibleForFk =
    !hasCitus ||
    (!clientLocationsDistributed && !invoiceChargesDistributed) ||
    (clientLocationsDistributed && invoiceChargesDistributed);

  if (compatibleForFk) {
    console.log(
      'invoice_charges and client_locations are compatible for FK - adding foreign key constraint'
    );
    await knex.schema.alterTable('invoice_charges', (table) => {
      table
        .foreign(['location_id', 'tenant'])
        .references(['location_id', 'tenant'])
        .inTable('client_locations')
        .onDelete('RESTRICT')
        .onUpdate('CASCADE');
    });
  } else {
    console.log(
      'invoice_charges and client_locations have incompatible distribution - skipping foreign key, adding index only'
    );
  }

  await knex.schema.alterTable('invoice_charges', (table) => {
    table.index(['tenant', 'invoice_id', 'location_id'], 'idx_invoice_charges_location');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  let clientLocationsDistributed = false;
  let invoiceChargesDistributed = false;
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
        const chargesResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'invoice_charges'::regclass
          ) as is_distributed
        `);
        invoiceChargesDistributed = chargesResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore
      }

      shouldDropForeignKey =
        (!clientLocationsDistributed && !invoiceChargesDistributed) ||
        (clientLocationsDistributed && invoiceChargesDistributed);
    }
  } catch (error) {
    // pg_dist_partition doesn't exist: FK was created.
  }

  await knex.schema.alterTable('invoice_charges', (table) => {
    table.dropIndex(['tenant', 'invoice_id', 'location_id'], 'idx_invoice_charges_location');
    if (shouldDropForeignKey) {
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};

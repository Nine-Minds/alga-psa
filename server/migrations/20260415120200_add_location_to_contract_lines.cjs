/**
 * Adds location_id to contract_lines so contract lines can be tagged per client
 * location. PK of contract_lines is (tenant, contract_line_id). Created by
 * 20251008000001_rename_billing_to_contracts.cjs.
 *
 * Follows the Citus-aware conditional FK pattern from
 * 20250613190110_add_location_to_tickets.cjs.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('contract_lines', (table) => {
    table.uuid('location_id').nullable();
  });

  let clientLocationsDistributed = false;
  let contractLinesDistributed = false;
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
        const linesResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'contract_lines'::regclass
          ) as is_distributed
        `);
        contractLinesDistributed = linesResult.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking contract_lines distribution:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with foreign key');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with foreign key');
  }

  const compatibleForFk =
    !hasCitus ||
    (!clientLocationsDistributed && !contractLinesDistributed) ||
    (clientLocationsDistributed && contractLinesDistributed);

  if (compatibleForFk) {
    console.log(
      'contract_lines and client_locations are compatible for FK - adding foreign key constraint'
    );
    await knex.schema.alterTable('contract_lines', (table) => {
      table
        .foreign(['location_id', 'tenant'])
        .references(['location_id', 'tenant'])
        .inTable('client_locations')
        .onDelete('RESTRICT')
        .onUpdate('CASCADE');
    });
  } else {
    console.log(
      'contract_lines and client_locations have incompatible distribution - skipping foreign key, adding index only'
    );
  }

  await knex.schema.alterTable('contract_lines', (table) => {
    table.index(['tenant', 'contract_id', 'location_id'], 'idx_contract_lines_location');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  let clientLocationsDistributed = false;
  let contractLinesDistributed = false;
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
        const linesResult = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = 'contract_lines'::regclass
          ) as is_distributed
        `);
        contractLinesDistributed = linesResult.rows[0].is_distributed;
      } catch (error) {
        // Ignore
      }

      shouldDropForeignKey =
        (!clientLocationsDistributed && !contractLinesDistributed) ||
        (clientLocationsDistributed && contractLinesDistributed);
    }
  } catch (error) {
    // pg_dist_partition doesn't exist: FK was created.
  }

  await knex.schema.alterTable('contract_lines', (table) => {
    table.dropIndex(['tenant', 'contract_id', 'location_id'], 'idx_contract_lines_location');
    if (shouldDropForeignKey) {
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};

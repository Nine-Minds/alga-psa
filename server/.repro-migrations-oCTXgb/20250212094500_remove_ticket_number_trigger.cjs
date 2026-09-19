exports.up = async function(knex) {
  try {
    // Check if the 'citus_tables' table exists
    const citusTablesExists = await knex.schema.hasTable('citus_tables');

    let isDistributed = false;

    if (citusTablesExists) {
      // Check if the 'tickets' table is distributed
      const result = await knex.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM citus_tables
          WHERE citus_tables.table_name::text = 'tickets'
        )
      `);

      isDistributed = result.rows[0].exists;
    }

    // Only drop the trigger if the table is not distributed
    if (!isDistributed) {
      await knex.raw('DROP TRIGGER IF EXISTS trigger_set_ticket_number ON tickets');
      await knex.raw('DROP FUNCTION IF EXISTS set_ticket_number()');
    }
  } catch (error) {
    // If the 'citus_tables' table doesn't exist or other errors occur,
    // assume the table is not distributed and proceed with the trigger removal.
    await knex.raw('DROP TRIGGER IF EXISTS trigger_set_ticket_number ON tickets');
    await knex.raw('DROP FUNCTION IF EXISTS set_ticket_number()');
  }
};

exports.down = function() {
  throw new Error('Irreversible migration');
};
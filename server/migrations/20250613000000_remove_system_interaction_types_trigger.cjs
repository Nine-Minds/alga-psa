/**
 * Remove trigger from system_interaction_types table to allow it to be used as a Citus reference table.
 * The trigger prevented UPDATE/DELETE operations, but no application code attempts to modify this table.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  let isDistributed = false;
  
  try {
    // Check if the table is a Citus distributed/reference table
    console.log('Checking if system_interaction_types is a Citus distributed/reference table...');
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_dist_partition 
        WHERE logicalrelid = 'system_interaction_types'::regclass
      ) as is_distributed
    `);
    
    isDistributed = result.rows[0].is_distributed;
  } catch (error) {
    // If pg_dist_partition doesn't exist, Citus is not installed
    console.log('Citus extension not detected - proceeding with standard PostgreSQL');
  }
  
  if (isDistributed) {
    console.log('Table system_interaction_types is a Citus distributed/reference table - skipping trigger drop and function cleanup');
  } else {
    console.log('Table system_interaction_types is not a distributed table - proceeding with trigger removal');
    
    // Only drop trigger and function if table is not distributed
    await knex.raw(`
      DROP TRIGGER IF EXISTS prevent_system_interaction_type_modification ON system_interaction_types;
      DROP FUNCTION IF EXISTS prevent_system_interaction_type_modification();
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Recreate the trigger and function
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_system_interaction_type_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Modification of system interaction types is not allowed';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER prevent_system_interaction_type_modification
    BEFORE UPDATE OR DELETE ON system_interaction_types
    FOR EACH ROW
    EXECUTE FUNCTION prevent_system_interaction_type_modification();
  `);
};
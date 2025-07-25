/**
 * Remove trigger from system_interaction_types table to allow it to be used as a Citus reference table.
 * The trigger prevented UPDATE/DELETE operations, but no application code attempts to modify this table.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS prevent_system_interaction_type_modification ON system_interaction_types;
    DROP FUNCTION IF EXISTS prevent_system_interaction_type_modification();
  `);
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
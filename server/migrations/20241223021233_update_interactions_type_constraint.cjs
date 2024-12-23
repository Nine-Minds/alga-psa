/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop existing foreign key constraint
  await knex.schema.alterTable('interactions', (table) => {
    table.dropForeign(['tenant', 'type_id']);
  });

  // Create function to validate interaction type
  await knex.raw(`
    CREATE OR REPLACE FUNCTION validate_interaction_type()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Check if type exists in system_interaction_types
      IF EXISTS (SELECT 1 FROM system_interaction_types WHERE type_id = NEW.type_id) THEN
        RETURN NEW;
      END IF;

      -- Check if type exists in tenant-specific interaction_types
      IF EXISTS (SELECT 1 FROM interaction_types WHERE tenant = NEW.tenant AND type_id = NEW.type_id) THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Invalid interaction type: type_id must exist in either system_interaction_types or interaction_types for the given tenant';
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    -- Create trigger
    CREATE TRIGGER validate_interaction_type_trigger
    BEFORE INSERT OR UPDATE ON interactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_interaction_type();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the trigger and function
  await knex.raw(`
    DROP TRIGGER IF EXISTS validate_interaction_type_trigger ON interactions;
    DROP FUNCTION IF EXISTS validate_interaction_type();
  `);

  // Recreate the original foreign key constraint
  await knex.schema.alterTable('interactions', (table) => {
    table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('interaction_types');
  });
};

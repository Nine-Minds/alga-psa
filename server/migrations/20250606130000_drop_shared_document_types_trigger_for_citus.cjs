exports.up = async function(knex) {
  // Drop the trigger that automatically updates the updated_at column
  // This is necessary for Citus reference table compatibility
  try {
    await knex.raw('DROP TRIGGER IF EXISTS update_shared_document_types_updated_at ON shared_document_types');
  } catch (error) {
    // If the table is already a Citus reference table, the trigger drop will fail
    // This is expected and we can safely continue
    if (error.message && error.message.includes('triggers are not supported on reference tables')) {
      console.log('Trigger does not exist on reference table shared_document_types - continuing...');
    } else {
      // Re-throw any other errors
      throw error;
    }
  }
  
  // Note: The update_updated_at_column() function is still used by other tables,
  // so we're not dropping it here
};

  exports.down = async function(knex) {
    // Check if shared_document_types is a reference table before trying to add trigger
    try {
      const result = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'shared_document_types'::regclass 
          AND partmethod = 'n' AND repmodel = 't'
        ) as is_reference_table
      `);

      if (result.rows[0].is_reference_table) {
        console.log('shared_document_types is a reference table - skipping trigger recreation');
        return;
      }

      // Recreate the trigger only if it's not a reference table
      await knex.raw(`
        CREATE TRIGGER update_shared_document_types_updated_at 
        BEFORE UPDATE ON shared_document_types 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column()
      `);
    } catch (error) {
      console.log('Error in down migration:', error.message);
      // Don't fail the rollback if we can't create the trigger
    }
  };
exports.up = async function(knex) {
  // Drop the trigger that automatically updates the updated_at column
  // This is necessary for Citus reference table compatibility
  await knex.raw('DROP TRIGGER IF EXISTS update_shared_document_types_updated_at ON shared_document_types');
  
  // Note: The update_updated_at_column() function is still used by other tables,
  // so we're not dropping it here
};

exports.down = async function(knex) {
  // Recreate the trigger
  await knex.raw(`
    CREATE TRIGGER update_shared_document_types_updated_at 
    BEFORE UPDATE ON shared_document_types 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column()
  `);
};
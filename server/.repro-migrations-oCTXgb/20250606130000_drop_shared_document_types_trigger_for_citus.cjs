  exports.up = async function(knex) {
    let isReferenceTable = false;
    
    // First check if Citus extension exists
    try {
      const citusCheck = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'citus'
        ) as has_citus
      `);
      
      if (citusCheck.rows[0].has_citus) {
        // Only check for distributed table if Citus is installed
        try {
          const result = await knex.raw(`
            SELECT EXISTS (
              SELECT 1 FROM pg_dist_partition 
              WHERE logicalrelid = 'shared_document_types'::regclass 
              AND partmethod = 'n' AND repmodel = 't'
            ) as is_reference_table
          `);
          isReferenceTable = result.rows[0].is_reference_table;
        } catch (error) {
          console.log('Error checking distribution status:', error.message);
        }
      } else {
        console.log('Citus extension not installed - proceeding with trigger drop');
      }
    } catch (error) {
      console.log('Error checking for Citus extension - proceeding with trigger drop');
    }

    if (isReferenceTable) {
      console.log('shared_document_types is a reference table - skipping trigger drop');
      return;
    }

    // Only attempt to drop trigger if it's not a reference table
    await knex.raw('DROP TRIGGER IF EXISTS update_shared_document_types_updated_at ON shared_document_types');
  };

  exports.down = async function(knex) {
    let isReferenceTable = false;
    
    // First check if Citus extension exists
    try {
      const citusCheck = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'citus'
        ) as has_citus
      `);
      
      if (citusCheck.rows[0].has_citus) {
        // Only check for distributed table if Citus is installed
        try {
          const result = await knex.raw(`
            SELECT EXISTS (
              SELECT 1 FROM pg_dist_partition 
              WHERE logicalrelid = 'shared_document_types'::regclass 
              AND partmethod = 'n' AND repmodel = 't'
            ) as is_reference_table
          `);
          isReferenceTable = result.rows[0].is_reference_table;
        } catch (error) {
          console.log('Error checking distribution status:', error.message);
        }
      } else {
        console.log('Citus extension not installed - proceeding with trigger recreation');
      }
    } catch (error) {
      console.log('Error checking for Citus extension - proceeding with trigger recreation');
    }

    if (isReferenceTable) {
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
  };
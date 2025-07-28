  exports.up = async function(knex) {
    let isReferenceTable = false;
    
    try {
      // Check if shared_document_types is a reference table first
      const result = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'shared_document_types'::regclass 
          AND partmethod = 'n' AND repmodel = 't'
        ) as is_reference_table
      `);
      isReferenceTable = result.rows[0].is_reference_table;
    } catch (error) {
      // If pg_dist_partition doesn't exist, Citus is not installed
      console.log('Citus extension not detected - proceeding with trigger drop');
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
    
    try {
      // Check if shared_document_types is a reference table before trying to add trigger
      const result = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'shared_document_types'::regclass 
          AND partmethod = 'n' AND repmodel = 't'
        ) as is_reference_table
      `);
      isReferenceTable = result.rows[0].is_reference_table;
    } catch (error) {
      // If pg_dist_partition doesn't exist, Citus is not installed
      console.log('Citus extension not detected - proceeding with trigger recreation');
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
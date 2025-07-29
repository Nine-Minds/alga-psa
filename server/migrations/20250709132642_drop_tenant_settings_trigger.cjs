/**
 * Drop the tenant_settings updated_at trigger since the backend already handles
 * updating the updated_at column explicitly in all update operations.
 * This follows the pattern established in other migrations of moving trigger
 * logic to application code for better control and Citus compatibility.
 */
exports.up = async function(knex) {
  let isDistributed = false;
  
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
            WHERE logicalrelid = 'tenant_settings'::regclass
          ) as is_distributed
        `);
        isDistributed = result.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking distribution status:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with trigger drop');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with trigger drop');
  }
  
  if (isDistributed) {
    console.log('Table tenant_settings is a Citus distributed/reference table - skipping trigger drop');
  } else {
    // Drop the trigger on tenant_settings table
    await knex.raw('DROP TRIGGER IF EXISTS update_tenant_settings_updated_at ON tenant_settings');
  }
};

exports.down = async function(knex) {
  let isDistributed = false;
  
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
            WHERE logicalrelid = 'tenant_settings'::regclass
          ) as is_distributed
        `);
        isDistributed = result.rows[0].is_distributed;
      } catch (error) {
        console.log('Error checking distribution status:', error.message);
      }
    } else {
      console.log('Citus extension not installed - proceeding with trigger recreation');
    }
  } catch (error) {
    console.log('Error checking for Citus extension - proceeding with trigger recreation');
  }
  
  if (isDistributed) {
    console.log('Table tenant_settings is a Citus distributed/reference table - skipping trigger recreation');
  } else {
    // Recreate the trigger if rolling back
    await knex.raw(`
      CREATE TRIGGER update_tenant_settings_updated_at
      BEFORE UPDATE ON tenant_settings
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `);
  }
};
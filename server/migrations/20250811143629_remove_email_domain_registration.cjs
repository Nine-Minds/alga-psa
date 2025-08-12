exports.up = async function(knex) {
  // Drop tables related to email domain registration
  // These were used for allowing self-registration based on email domains
  // Removed for security reasons - registration now only allowed for existing contacts
  
  // Simple and straightforward approach for Citus:
  // 1. Drop known foreign keys from pending_registrations (the only distributed table with FKs)
  // 2. Undistribute pending_registrations if it's distributed
  // 3. Drop all three tables with CASCADE
  
  // Drop foreign keys from pending_registrations (we know these exist from the query results)
  await knex.raw('ALTER TABLE IF EXISTS pending_registrations DROP CONSTRAINT IF EXISTS pending_registrations_tenant_foreign');
  await knex.raw('ALTER TABLE IF EXISTS pending_registrations DROP CONSTRAINT IF EXISTS pending_registrations_tenant_company_id_foreign');
  
  // Undistribute pending_registrations if it's distributed (required for Citus)
  // First check if we're using Citus by checking if the undistribute_table function exists
  // NOTE: These are system catalog queries that don't need tenant conditions
  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'undistribute_table'
      ) as has_citus
    `);
    
    if (citusCheck.rows[0].has_citus) {
      // We have Citus, check if the table is distributed
      // NOTE: pg_dist_partition is a Citus system catalog, no tenant needed
      const distCheck = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'pending_registrations'::regclass
        ) as is_distributed
      `);
      
      if (distCheck.rows[0].is_distributed) {
        // Table is distributed, undistribute it
        await knex.raw('SELECT undistribute_table(\'pending_registrations\')');
        // Successfully undistributed pending_registrations table
      }
    }
  } catch (err) {
    // Any error here is not critical - continue with dropping tables
    // Note: Citus check/undistribute step skipped
  }
  
  // Now drop all tables with CASCADE to handle any remaining dependencies
  await knex.raw('DROP TABLE IF EXISTS company_email_settings CASCADE');
  await knex.raw('DROP TABLE IF EXISTS verification_tokens CASCADE');
  await knex.raw('DROP TABLE IF EXISTS pending_registrations CASCADE');
  
  // Successfully dropped email domain registration tables
};

exports.down = async function(knex) {
  // NO-OP: Security-driven removal should not be rolled back
  // These tables were removed for security reasons and should not be recreated
  // Email domain registration tables were removed for security reasons and will not be recreated
  return;
};
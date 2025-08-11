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
  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'undistribute_table'
      ) as has_citus
    `);
    
    if (citusCheck.rows[0].has_citus) {
      // We have Citus, check if the table is distributed
      const distCheck = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'pending_registrations'::regclass
        ) as is_distributed
      `);
      
      if (distCheck.rows[0].is_distributed) {
        // Table is distributed, undistribute it
        await knex.raw('SELECT undistribute_table(\'pending_registrations\')');
        console.log('Undistributed pending_registrations table');
      }
    }
  } catch (err) {
    // Any error here is not critical - continue with dropping tables
    console.log('Note: Citus check/undistribute step skipped:', err.message);
  }
  
  // Now drop all tables with CASCADE to handle any remaining dependencies
  await knex.raw('DROP TABLE IF EXISTS company_email_settings CASCADE');
  await knex.raw('DROP TABLE IF EXISTS verification_tokens CASCADE');
  await knex.raw('DROP TABLE IF EXISTS pending_registrations CASCADE');
  
  console.log('Successfully dropped email domain registration tables');
};

exports.down = async function(knex) {
  // Recreate tables if rolling back (not recommended - these tables should stay removed)
  
  // Recreate company_email_settings table
  await knex.schema.createTable('company_email_settings', function(table) {
    table.uuid('setting_id').primary();
    table.uuid('company_id').notNullable();
    table.uuid('tenant').notNullable();
    table.string('email_suffix').notNullable();
    table.boolean('self_registration_enabled').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['company_id', 'email_suffix']);
    table.index(['email_suffix', 'tenant']);
  });
  
  // Try to add foreign key constraint, but don't fail if companies table doesn't exist
  try {
    await knex.schema.alterTable('company_email_settings', function(table) {
      table.foreign(['company_id', 'tenant']).references(['company_id', 'tenant']).inTable('companies');
    });
  } catch (err) {
    console.log('Could not add foreign key to companies table:', err.message);
  }
  
  // Recreate verification_tokens table
  await knex.schema.createTable('verification_tokens', function(table) {
    table.uuid('token_id').primary();
    table.uuid('tenant').notNullable();
    table.uuid('registration_id').notNullable();
    table.uuid('company_id').notNullable();
    table.string('token').notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['token']);
    table.index(['registration_id']);
  });
  
  // Recreate pending_registrations table
  await knex.schema.createTable('pending_registrations', function(table) {
    table.uuid('registration_id').primary();
    table.uuid('tenant').notNullable();
    table.string('email').notNullable();
    table.string('hashed_password').notNullable();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.uuid('company_id').notNullable();
    table.enum('status', ['PENDING_VERIFICATION', 'VERIFIED', 'COMPLETED', 'EXPIRED']).defaultTo('PENDING_VERIFICATION');
    table.timestamp('expires_at').notNullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['email', 'tenant']);
    table.index(['status']);
  });
};
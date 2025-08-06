/**
 * Distribute companies and contacts tables together
 * Handles circular dependency by temporarily dropping and recreating foreign keys
 */

exports.up = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping table distribution');
    return;
  }

  console.log('Distributing companies and contacts tables (handling circular dependency)...');
  
  try {
    // Step 1: Drop the foreign key constraint from companies to contacts
    console.log('  Step 1: Dropping foreign key constraints to break circular dependency...');
    
    // Check if the foreign key exists before trying to drop it
    const fkExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_type = 'FOREIGN KEY' 
        AND table_name = 'companies' 
        AND constraint_name = 'companies_tenant_billing_contact_id_foreign'
      ) as exists
    `);
    
    if (fkExists.rows[0].exists) {
      await knex.raw(`
        ALTER TABLE companies 
        DROP CONSTRAINT companies_tenant_billing_contact_id_foreign
      `);
      console.log('    ✓ Dropped companies → contacts foreign key');
    } else {
      console.log('    - Foreign key already dropped or does not exist');
    }
    
    // Step 2: Distribute companies table
    console.log('  Step 2: Distributing companies table...');
    
    const companiesDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'companies'::regclass
      ) as distributed
    `);
    
    if (!companiesDistributed.rows[0].distributed) {
      await knex.raw(`SELECT create_distributed_table('companies', 'tenant')`);
      console.log('    ✓ Distributed companies table');
    } else {
      console.log('    - Companies table already distributed');
    }
    
    // Step 3: Distribute contacts table
    console.log('  Step 3: Distributing contacts table...');
    
    const contactsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'contacts'::regclass
      ) as distributed
    `);
    
    if (!contactsDistributed.rows[0].distributed) {
      await knex.raw(`SELECT create_distributed_table('contacts', 'tenant')`);
      console.log('    ✓ Distributed contacts table');
    } else {
      console.log('    - Contacts table already distributed');
    }
    
    // Step 4: Recreate the foreign key constraint
    console.log('  Step 4: Recreating foreign key constraint...');
    
    // Check if we need to recreate the constraint
    const fkExistsAfter = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_type = 'FOREIGN KEY' 
        AND table_name = 'companies' 
        AND constraint_name = 'companies_tenant_billing_contact_id_foreign'
      ) as exists
    `);
    
    if (!fkExistsAfter.rows[0].exists) {
      // Check if billing_contact_id column exists
      const columnExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'companies' 
          AND column_name = 'billing_contact_id'
        ) as exists
      `);
      
      if (columnExists.rows[0].exists) {
        await knex.raw(`
          ALTER TABLE companies 
          ADD CONSTRAINT companies_tenant_billing_contact_id_foreign 
          FOREIGN KEY (tenant, billing_contact_id) 
          REFERENCES contacts(tenant, contact_name_id)
          ON DELETE SET NULL
        `);
        console.log('    ✓ Recreated companies → contacts foreign key');
      } else {
        console.log('    - billing_contact_id column does not exist, skipping FK recreation');
      }
    } else {
      console.log('    - Foreign key already exists');
    }
    
    console.log('  ✓ Successfully distributed companies and contacts tables');
    
  } catch (error) {
    console.error(`  ✗ Failed to distribute companies/contacts: ${error.message}`);
    throw error;
  }
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, nothing to undo');
    return;
  }

  console.log('Undistributing companies and contacts tables...');
  
  try {
    // Undistribute contacts first (reverse order)
    const contactsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'contacts'::regclass
      ) as distributed
    `);
    
    if (contactsDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('contacts')`);
      console.log('  ✓ Undistributed contacts table');
    }
    
    // Undistribute companies
    const companiesDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'companies'::regclass
      ) as distributed
    `);
    
    if (companiesDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('companies')`);
      console.log('  ✓ Undistributed companies table');
    }
    
  } catch (error) {
    console.error(`  ✗ Failed to undistribute companies/contacts: ${error.message}`);
  }
};
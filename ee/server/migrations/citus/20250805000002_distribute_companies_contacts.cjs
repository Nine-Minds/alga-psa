/**
 * Distribute companies and contacts tables together
 * Handles circular dependency and all foreign key constraints
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

  console.log('Distributing companies and contacts tables (handling all dependencies)...');
  
  try {
    // Step 0a: First create reference tables for true lookup/configuration tables
    console.log('  Step 0a: Creating reference tables for lookup data...');
    
    const referenceTables = [
      'invoice_templates',
      'countries',  // If exists
      'currencies', // If exists
    ];
    
    for (const tableName of referenceTables) {
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [tableName]);
      
      if (tableExists.rows[0].exists) {
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [tableName]);
        
        if (!isDistributed.rows[0].distributed) {
          try {
            await knex.raw(`SELECT create_reference_table('${tableName}')`);
            console.log(`    ✓ Created ${tableName} as reference table`);
          } catch (e) {
            console.log(`    - Could not create ${tableName} as reference table: ${e.message}`);
          }
        } else {
          console.log(`    - ${tableName} already distributed`);
        }
      }
    }
    
    // Step 0b: Distribute tax_regions as a distributed table (has FK to tenants)
    console.log('  Step 0b: Distributing tax_regions table...');
    
    const taxRegionsExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'tax_regions'
      ) as exists
    `);
    
    if (taxRegionsExists.rows[0].exists) {
      const taxRegionsDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'tax_regions'::regclass
        ) as distributed
      `);
      
      if (!taxRegionsDistributed.rows[0].distributed) {
        try {
          await knex.raw(`SELECT create_distributed_table('tax_regions', 'tenant')`);
          console.log('    ✓ Distributed tax_regions table');
        } catch (e) {
          console.log(`    - Could not distribute tax_regions: ${e.message}`);
        }
      } else {
        console.log('    - tax_regions already distributed');
      }
    }
    
    // Step 1: Store all foreign key constraints we need to drop
    console.log('  Step 1: Identifying foreign key constraints to temporarily drop...');
    
    const constraintsToDrop = [
      // Companies FK to contacts (circular dependency)
      'companies_tenant_billing_contact_id_foreign',
      // Companies FK to documents
      'companies_tenant_notes_document_id_foreign',
      // Companies FK to users (account_manager)
      'fk_companies_account_manager',
      // Companies FK to tax_regions (if not made reference table)
      'companies_tenant_region_code_fkey',
      // Contacts FK to companies (circular dependency)
      'contacts_tenant_company_id_foreign'
    ];
    
    const droppedConstraints = [];
    
    // Step 2: Drop the foreign key constraints
    console.log('  Step 2: Dropping foreign key constraints to break dependencies...');
    
    for (const constraintName of constraintsToDrop) {
      try {
        // Check which table has this constraint
        const constraintInfo = await knex.raw(`
          SELECT table_name 
          FROM information_schema.table_constraints 
          WHERE constraint_name = ? 
          AND constraint_type = 'FOREIGN KEY'
          AND table_schema = 'public'
        `, [constraintName]);
        
        if (constraintInfo.rows.length > 0) {
          const tableName = constraintInfo.rows[0].table_name;
          
          // Store constraint definition for recreation
          const constraintDef = await knex.raw(`
            SELECT 
              tc.table_name,
              tc.constraint_name,
              string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns,
              ccu.table_name AS foreign_table,
              string_agg(ccu.column_name, ', ' ORDER BY kcu.ordinal_position) AS foreign_columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
              AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_name = ?
              AND tc.table_schema = 'public'
            GROUP BY tc.table_name, tc.constraint_name, ccu.table_name
          `, [constraintName]);
          
          if (constraintDef.rows.length > 0) {
            droppedConstraints.push(constraintDef.rows[0]);
            await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`);
            console.log(`    ✓ Dropped ${constraintName} from ${tableName}`);
          }
        }
      } catch (e) {
        console.log(`    - Could not drop ${constraintName}: ${e.message}`);
      }
    }
    
    // Step 3: Distribute documents table first (if exists) since companies references it
    console.log('  Step 3: Distributing documents table (if exists)...');
    
    const documentsExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'documents'
      ) as exists
    `);
    
    if (documentsExists.rows[0].exists) {
      const documentsDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'documents'::regclass
        ) as distributed
      `);
      
      if (!documentsDistributed.rows[0].distributed) {
        try {
          await knex.raw(`SELECT create_distributed_table('documents', 'tenant')`);
          console.log('    ✓ Distributed documents table');
        } catch (e) {
          console.log(`    - Could not distribute documents: ${e.message}`);
        }
      } else {
        console.log('    - documents table already distributed');
      }
    }
    
    // Step 4: Distribute companies table
    console.log('  Step 4: Distributing companies table...');
    
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
    
    // Step 5: Distribute contacts table
    console.log('  Step 5: Distributing contacts table...');
    
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
    
    // Step 6: Recreate the foreign key constraints
    console.log('  Step 6: Recreating foreign key constraints...');
    
    for (const constraint of droppedConstraints) {
      try {
        const { table_name, constraint_name, columns, foreign_table, foreign_columns } = constraint;
        
        // Check if both tables involved are distributed or reference tables
        const tableDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [table_name]);
        
        const foreignTableDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [foreign_table]);
        
        if (tableDistributed.rows[0].distributed && foreignTableDistributed.rows[0].distributed) {
          await knex.raw(`
            ALTER TABLE ${table_name} 
            ADD CONSTRAINT ${constraint_name} 
            FOREIGN KEY (${columns}) 
            REFERENCES ${foreign_table}(${foreign_columns})
            ON DELETE SET NULL
          `);
          console.log(`    ✓ Recreated ${constraint_name}`);
        } else {
          console.log(`    - Skipped ${constraint_name} (tables not both distributed)`);
        }
      } catch (e) {
        console.log(`    - Could not recreate constraint ${constraint.constraint_name}: ${e.message}`);
      }
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
    // Undistribute in reverse order
    const tablesToUndistribute = ['contacts', 'companies', 'documents', 'tax_regions'];
    
    for (const tableName of tablesToUndistribute) {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${tableName}')`);
        console.log(`  ✓ Undistributed ${tableName} table`);
      }
    }
    
  } catch (error) {
    console.error(`  ✗ Failed to undistribute: ${error.message}`);
  }
};
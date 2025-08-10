/**
 * Distribute billing-related tables
 * Dependencies: companies, contacts must be distributed first
 */
exports.config = { transaction: false };

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

  console.log('Distributing billing tables...');
  
  const tables = [
    'invoices',
    'invoice_items',
    'payments',
    'credits',
    'billing_cycles'
  ];
  
  for (const table of tables) {
    try {
      console.log(`\nProcessing ${table}...`);
      
      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  ${table} already distributed`);
        continue;
      }

      // Step 1: Drop foreign key constraints
      console.log(`  Dropping foreign key constraints for ${table}...`);
      const fkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'f'
      `);
      
      for (const fk of fkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname}`);
          console.log(`    ✓ Dropped FK: ${fk.conname}`);
        } catch (e) {
          console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
        }
      }
      
      // Step 2: Drop unique constraints
      console.log(`  Dropping unique constraints for ${table}...`);
      const uniqueConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'u'
      `);
      
      for (const constraint of uniqueConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname}`);
          console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
        } catch (e) {
          console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 3: Distribute the table
      console.log(`  Distributing ${table}...`);
      await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      console.log(`    ✓ Distributed ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      throw error;
    }
  }
  
  // After all tables are distributed, recreate critical FKs between distributed tables
  console.log('\nRecreating foreign keys between distributed tables...');
  
  try {
    // invoice_items -> invoices
    await knex.raw(`
      ALTER TABLE invoice_items 
      ADD CONSTRAINT invoice_items_tenant_invoice_id_foreign 
      FOREIGN KEY (tenant, invoice_id) 
      REFERENCES invoices(tenant, invoice_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: invoice_items -> invoices');
  } catch (e) {
    console.log(`  - Could not recreate FK invoice_items -> invoices: ${e.message}`);
  }
  
  try {
    // payments -> invoices
    await knex.raw(`
      ALTER TABLE payments 
      ADD CONSTRAINT payments_tenant_invoice_id_foreign 
      FOREIGN KEY (tenant, invoice_id) 
      REFERENCES invoices(tenant, invoice_id) 
      ON DELETE SET NULL
    `);
    console.log('  ✓ Recreated FK: payments -> invoices');
  } catch (e) {
    console.log(`  - Could not recreate FK payments -> invoices: ${e.message}`);
  }
  
  try {
    // invoices -> companies
    await knex.raw(`
      ALTER TABLE invoices 
      ADD CONSTRAINT invoices_tenant_company_id_foreign 
      FOREIGN KEY (tenant, company_id) 
      REFERENCES companies(tenant, company_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: invoices -> companies');
  } catch (e) {
    console.log(`  - Could not recreate FK invoices -> companies: ${e.message}`);
  }
  
  console.log('\n✓ All billing tables distributed successfully');
};

exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing billing tables...');
  
  const tables = [
    'invoice_items',
    'payments', 
    'credits',
    'billing_cycles',
    'invoices'
  ];
  
  for (const table of tables) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute ${table}: ${error.message}`);
    }
  }
};
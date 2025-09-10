/**
 * Fix tax_components distribution and composite_tax_mappings reference table
 * This must run after migration 20 to handle the special dependency between these tables
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
    console.log('Citus not enabled, skipping tax tables fix');
    return;
  }

  console.log('Fixing tax_components distribution and composite_tax_mappings...');
  
  // Step 1: Ensure tax_components is distributed
  try {
    // Check if tax_components exists
    const tableExists = await knex.schema.hasTable('tax_components');
    if (!tableExists) {
      console.log('tax_components table does not exist, skipping');
      return;
    }
    
    // Check if already distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'tax_components'::regclass
      ) as distributed
    `);
    
    if (!isDistributed.rows[0].distributed) {
      console.log('Distributing tax_components with special handling...');
      
      // Drop ALL constraints and indexes to ensure clean distribution
      console.log('  Dropping all constraints from tax_components...');
      
      // Get all constraints except primary key
      const constraints = await knex.raw(`
        SELECT conname, contype
        FROM pg_constraint
        WHERE conrelid = 'tax_components'::regclass
        AND contype != 'p'
      `);
      
      for (const constraint of constraints.rows) {
        try {
          await knex.raw(`ALTER TABLE tax_components DROP CONSTRAINT IF EXISTS ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
        } catch (e) {
          console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Drop all indexes except primary key
      const indexes = await knex.raw(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'tax_components'
        AND indexname NOT LIKE '%_pkey'
      `);
      
      for (const idx of indexes.rows) {
        try {
          await knex.raw(`DROP INDEX IF EXISTS ${idx.indexname} CASCADE`);
          console.log(`    ✓ Dropped index: ${idx.indexname}`);
        } catch (e) {
          console.log(`    - Could not drop index ${idx.indexname}: ${e.message}`);
        }
      }
      
      // Drop all triggers
      const triggers = await knex.raw(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'tax_components'::regclass
        AND tgisinternal = false
      `);
      
      for (const trigger of triggers.rows) {
        try {
          await knex.raw(`DROP TRIGGER IF EXISTS ${trigger.tgname} ON tax_components`);
          console.log(`    ✓ Dropped trigger: ${trigger.tgname}`);
        } catch (e) {
          console.log(`    - Could not drop trigger ${trigger.tgname}: ${e.message}`);
        }
      }
      
      // Now distribute the table
      console.log('  Distributing tax_components...');
      await knex.raw(`SELECT create_distributed_table('tax_components', 'tenant', colocate_with => 'tenants')`);
      console.log('  ✓ Successfully distributed tax_components');
      
      // Recreate the foreign key to tax_rates
      try {
        await knex.raw(`
          ALTER TABLE tax_components 
          ADD CONSTRAINT tax_components_tax_rate_id_foreign 
          FOREIGN KEY (tenant, tax_rate_id) 
          REFERENCES tax_rates(tenant, tax_rate_id) 
          ON DELETE CASCADE
        `);
        console.log('  ✓ Recreated FK: tax_components -> tax_rates');
      } catch (e) {
        console.log(`  - Could not recreate FK to tax_rates: ${e.message}`);
      }
    } else {
      console.log('tax_components is already distributed');
    }
    
  } catch (error) {
    console.error(`Failed to distribute tax_components: ${error.message}`);
    // Don't stop, try to handle composite_tax_mappings anyway
  }
  
  // Step 2: Make composite_tax_mappings a reference table
  try {
    // Check if composite_tax_mappings exists
    const compTableExists = await knex.schema.hasTable('composite_tax_mappings');
    if (!compTableExists) {
      console.log('composite_tax_mappings table does not exist, skipping');
      return;
    }
    
    // Check if already a reference table
    const isReference = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'composite_tax_mappings'::regclass
        AND partmethod = 'n'
      ) as is_reference
    `);
    
    if (!isReference.rows[0].is_reference) {
      console.log('Creating composite_tax_mappings as reference table...');
      
      // Drop foreign key constraints first
      const fkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'composite_tax_mappings'::regclass
        AND contype = 'f'
      `);
      
      for (const fk of fkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE composite_tax_mappings DROP CONSTRAINT IF EXISTS ${fk.conname}`);
          console.log(`  ✓ Dropped FK: ${fk.conname}`);
        } catch (e) {
          console.log(`  - Could not drop FK ${fk.conname}: ${e.message}`);
        }
      }
      
      // Create as reference table
      await knex.raw(`SELECT create_reference_table('composite_tax_mappings')`);
      console.log('  ✓ Successfully created composite_tax_mappings as reference table');
      
      // Recreate foreign keys
      try {
        // FK to tax_rates
        await knex.raw(`
          ALTER TABLE composite_tax_mappings 
          ADD CONSTRAINT composite_tax_mappings_composite_tax_id_foreign 
          FOREIGN KEY (composite_tax_id) 
          REFERENCES tax_rates(tax_rate_id) 
          ON DELETE CASCADE
        `);
        console.log('  ✓ Recreated FK: composite_tax_mappings -> tax_rates');
        
        // FK to tax_components
        await knex.raw(`
          ALTER TABLE composite_tax_mappings 
          ADD CONSTRAINT composite_tax_mappings_tax_component_id_foreign 
          FOREIGN KEY (tax_component_id) 
          REFERENCES tax_components(tax_component_id) 
          ON DELETE CASCADE
        `);
        console.log('  ✓ Recreated FK: composite_tax_mappings -> tax_components');
      } catch (e) {
        console.log(`  - Could not recreate FKs: ${e.message}`);
      }
    } else {
      console.log('composite_tax_mappings is already a reference table');
    }
    
  } catch (error) {
    console.error(`Failed to create composite_tax_mappings as reference table: ${error.message}`);
  }
  
  console.log('\n✓ Tax tables distribution fix completed');
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

  console.log('Undistributing tax tables...');
  
  try {
    // Undistribute composite_tax_mappings first
    const compIsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'composite_tax_mappings'::regclass
      ) as distributed
    `);
    
    if (compIsDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('composite_tax_mappings')`);
      console.log('  ✓ Undistributed composite_tax_mappings');
    }
    
    // Then undistribute tax_components
    const taxIsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'tax_components'::regclass
      ) as distributed
    `);
    
    if (taxIsDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('tax_components')`);
      console.log('  ✓ Undistributed tax_components');
    }
    
  } catch (error) {
    console.error(`Failed to undistribute tax tables: ${error.message}`);
  }
};
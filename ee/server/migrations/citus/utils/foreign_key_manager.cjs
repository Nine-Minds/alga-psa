/**
 * Utility functions for managing foreign keys during Citus distribution
 * Captures existing FKs before dropping and recreates valid ones after distribution
 */

/**
 * Capture all foreign keys for a table before distribution
 */
async function captureForeignKeys(knex, tableName) {
  const fks = await knex.raw(`
    SELECT 
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_schema = 'public'
      AND tc.table_name = ?
    ORDER BY tc.constraint_name, kcu.ordinal_position
  `, [tableName]);
  
  // Group by constraint name to handle composite foreign keys
  const groupedFks = {};
  for (const fk of fks.rows) {
    if (!groupedFks[fk.constraint_name]) {
      groupedFks[fk.constraint_name] = {
        constraint_name: fk.constraint_name,
        table_name: fk.table_name,
        foreign_table_name: fk.foreign_table_name,
        columns: [],
        foreign_columns: [],
        update_rule: fk.update_rule,
        delete_rule: fk.delete_rule
      };
    }
    groupedFks[fk.constraint_name].columns.push(fk.column_name);
    groupedFks[fk.constraint_name].foreign_columns.push(fk.foreign_column_name);
  }
  
  return Object.values(groupedFks);
}

/**
 * Check if a table is distributed
 */
async function isDistributed(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition 
      WHERE logicalrelid = ?::regclass
      AND partmethod = 'h'
    ) as distributed
  `, [tableName]);
  return result.rows[0].distributed;
}

/**
 * Check if a table is a reference table
 */
async function isReference(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition 
      WHERE logicalrelid = ?::regclass
      AND partmethod = 'n'
    ) as is_reference
  `, [tableName]);
  return result.rows[0].is_reference;
}

/**
 * Check if a table has a tenant column
 */
async function hasTenantColumn(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = ?
      AND column_name IN ('tenant', 'tenant_id')
    ) as has_tenant
  `, [tableName]);
  return result.rows[0].has_tenant;
}

/**
 * Recreate foreign keys after distribution
 */
async function recreateForeignKeys(knex, tableName, capturedFks = null) {
  // If no captured FKs provided, try to recreate based on standard patterns
  if (!capturedFks) {
    console.log(`  No captured FKs for ${tableName}, skipping FK recreation`);
    return;
  }
  
  let recreatedCount = 0;
  let failedCount = 0;
  
  for (const fk of capturedFks) {
    try {
      const sourceDistributed = await isDistributed(knex, fk.table_name);
      const targetDistributed = await isDistributed(knex, fk.foreign_table_name);
      const targetReference = await isReference(knex, fk.foreign_table_name);
      const sourceHasTenant = await hasTenantColumn(knex, fk.table_name);
      const targetHasTenant = await hasTenantColumn(knex, fk.foreign_table_name);
      
      let recreated = false;
      
      // Case 1: Both tables are distributed with tenant columns
      if (sourceDistributed && targetDistributed && sourceHasTenant && targetHasTenant) {
        // Check if FK already includes tenant
        const includesTenant = fk.columns.includes('tenant') || fk.columns.includes('tenant_id');
        
        // Citus doesn't support ON DELETE SET NULL for distributed tables
        let deleteRule = fk.delete_rule;
        if (deleteRule === 'SET NULL') {
          deleteRule = 'RESTRICT';
          console.log(`    ⚠ Changed ON DELETE SET NULL to RESTRICT for Citus compatibility`);
        }
        
        if (includesTenant) {
          // FK already includes tenant, recreate as-is
          await knex.raw(`
            ALTER TABLE ${fk.table_name}
            ADD CONSTRAINT ${fk.constraint_name}
            FOREIGN KEY (${fk.columns.join(', ')})
            REFERENCES ${fk.foreign_table_name}(${fk.foreign_columns.join(', ')})
            ${deleteRule !== 'NO ACTION' ? `ON DELETE ${deleteRule}` : ''}
            ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
          `);
        } else {
          // Add tenant to the FK
          const newColumns = ['tenant', ...fk.columns];
          const newForeignColumns = ['tenant', ...fk.foreign_columns];
          
          await knex.raw(`
            ALTER TABLE ${fk.table_name}
            ADD CONSTRAINT ${fk.constraint_name}
            FOREIGN KEY (${newColumns.join(', ')})
            REFERENCES ${fk.foreign_table_name}(${newForeignColumns.join(', ')})
            ${deleteRule !== 'NO ACTION' ? `ON DELETE ${deleteRule}` : ''}
            ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
          `);
        }
        recreated = true;
        console.log(`    ✓ Recreated FK: ${fk.constraint_name} (distributed->distributed)`);
      }
      // Case 2: Source distributed, target is reference table
      else if (sourceDistributed && targetReference) {
        // Can reference without tenant column
        await knex.raw(`
          ALTER TABLE ${fk.table_name}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.columns.join(', ')})
          REFERENCES ${fk.foreign_table_name}(${fk.foreign_columns.join(', ')})
          ${fk.delete_rule !== 'NO ACTION' ? `ON DELETE ${fk.delete_rule}` : ''}
          ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
        `);
        recreated = true;
        console.log(`    ✓ Recreated FK: ${fk.constraint_name} (distributed->reference)`);
      }
      // Case 3: Both tables are reference tables
      else if (!sourceDistributed && !targetDistributed && 
               (await isReference(knex, fk.table_name)) && targetReference) {
        await knex.raw(`
          ALTER TABLE ${fk.table_name}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.columns.join(', ')})
          REFERENCES ${fk.foreign_table_name}(${fk.foreign_columns.join(', ')})
          ${fk.delete_rule !== 'NO ACTION' ? `ON DELETE ${fk.delete_rule}` : ''}
          ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
        `);
        recreated = true;
        console.log(`    ✓ Recreated FK: ${fk.constraint_name} (reference->reference)`);
      }
      // Case 4: Both tables are local (non-distributed)
      else if (!sourceDistributed && !targetDistributed && 
               !(await isReference(knex, fk.table_name)) && !targetReference) {
        await knex.raw(`
          ALTER TABLE ${fk.table_name}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.columns.join(', ')})
          REFERENCES ${fk.foreign_table_name}(${fk.foreign_columns.join(', ')})
          ${fk.delete_rule !== 'NO ACTION' ? `ON DELETE ${fk.delete_rule}` : ''}
          ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
        `);
        recreated = true;
        console.log(`    ✓ Recreated FK: ${fk.constraint_name} (local->local)`);
      }
      // Case 5: FK to tenants table (special case - always allowed)
      else if (fk.foreign_table_name === 'tenants') {
        await knex.raw(`
          ALTER TABLE ${fk.table_name}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.columns.join(', ')})
          REFERENCES ${fk.foreign_table_name}(${fk.foreign_columns.join(', ')})
          ${fk.delete_rule !== 'NO ACTION' ? `ON DELETE ${fk.delete_rule}` : ''}
          ${fk.update_rule !== 'NO ACTION' ? `ON UPDATE ${fk.update_rule}` : ''}
        `);
        recreated = true;
        console.log(`    ✓ Recreated FK: ${fk.constraint_name} (->tenants)`);
      }
      
      if (recreated) {
        recreatedCount++;
      } else {
        console.log(`    ⊘ Skipped FK: ${fk.constraint_name} (incompatible with Citus)`);
      }
      
    } catch (e) {
      failedCount++;
      console.log(`    ✗ Failed to recreate FK ${fk.constraint_name}: ${e.message}`);
    }
  }
  
  if (recreatedCount > 0 || failedCount > 0) {
    console.log(`    Summary: ${recreatedCount} FKs recreated, ${failedCount} failed, ${capturedFks.length - recreatedCount - failedCount} skipped`);
  }
}

/**
 * Drop and capture all foreign keys for a table
 */
async function dropAndCaptureForeignKeys(knex, tableName) {
  // First capture the FKs
  const capturedFks = await captureForeignKeys(knex, tableName);
  
  // Then drop them
  console.log(`  Dropping foreign key constraints for ${tableName}...`);
  const fkConstraints = await knex.raw(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = ?::regclass
    AND contype = 'f'
  `, [tableName]);
  
  for (const fk of fkConstraints.rows) {
    try {
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${fk.conname}`);
      console.log(`    ✓ Dropped FK: ${fk.conname}`);
    } catch (e) {
      console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
    }
  }
  
  return capturedFks;
}

module.exports = {
  captureForeignKeys,
  isDistributed,
  isReference,
  hasTenantColumn,
  recreateForeignKeys,
  dropAndCaptureForeignKeys
};
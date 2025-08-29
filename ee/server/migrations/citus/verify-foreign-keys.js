#!/usr/bin/env node

/**
 * Script to verify foreign key integrity after Citus distribution
 * Checks for missing foreign keys that should exist between distributed tables
 */

const knex = require('knex');
const config = require('../../knexfile.cjs');

async function verifyForeignKeys() {
  const db = knex(config);
  
  try {
    console.log('=== Foreign Key Verification for Citus Distributed Tables ===\n');
    
    // Check if Citus is enabled
    const citusEnabled = await db.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) as enabled
    `);
    
    if (!citusEnabled.rows[0].enabled) {
      console.log('Citus is not enabled - skipping verification');
      return;
    }
    
    // Get all distributed tables
    const distributedTables = await db.raw(`
      SELECT logicalrelid::regclass::text as table_name
      FROM pg_dist_partition
      WHERE partmethod = 'h'
      ORDER BY logicalrelid::regclass::text
    `);
    
    console.log(`Found ${distributedTables.rows.length} distributed tables\n`);
    
    // Expected foreign keys between distributed tables
    const expectedFKs = [
      // Invoice relationships
      { from_table: 'invoice_items', to_table: 'invoices', fk_name: 'invoice_items_tenant_invoice_id_foreign' },
      { from_table: 'invoices', to_table: 'companies', fk_name: 'invoices_tenant_company_id_foreign' },
      
      // Ticket relationships
      { from_table: 'ticket_resources', to_table: 'tickets', fk_name: 'ticket_resources_tenant_ticket_id_foreign' },
      { from_table: 'tickets', to_table: 'companies', fk_name: 'tickets_tenant_company_id_foreign' },
      { from_table: 'tickets', to_table: 'contacts', fk_name: 'tickets_tenant_contact_id_foreign' },
      
      // Project relationships
      { from_table: 'project_tasks', to_table: 'projects', fk_name: 'project_tasks_tenant_project_id_foreign' },
      { from_table: 'project_phases', to_table: 'projects', fk_name: 'project_phases_tenant_project_id_foreign' },
      { from_table: 'projects', to_table: 'companies', fk_name: 'projects_tenant_company_id_foreign' },
      
      // User relationships
      { from_table: 'user_roles', to_table: 'users', fk_name: 'user_roles_tenant_user_id_foreign' },
      { from_table: 'user_roles', to_table: 'roles', fk_name: 'user_roles_tenant_role_id_foreign' },
      
      // Time tracking
      { from_table: 'time_entries', to_table: 'users', fk_name: 'time_entries_tenant_user_id_foreign' },
      { from_table: 'time_sheets', to_table: 'users', fk_name: 'time_sheets_tenant_user_id_foreign' },
      
      // Tax relationships
      { from_table: 'tax_components', to_table: 'tax_rates', fk_name: 'tax_components_tax_rate_id_foreign' },
      
      // Document relationships
      { from_table: 'document_versions', to_table: 'documents', fk_name: 'document_versions_tenant_document_id_foreign' },
      
      // Contact/Company relationships
      { from_table: 'contacts', to_table: 'companies', fk_name: 'contacts_tenant_company_id_foreign' },
      
      // Team relationships
      { from_table: 'team_members', to_table: 'teams', fk_name: 'team_members_tenant_team_id_foreign' },
      { from_table: 'team_members', to_table: 'users', fk_name: 'team_members_tenant_user_id_foreign' }
    ];
    
    let missingCount = 0;
    let existingCount = 0;
    const missingFKs = [];
    
    console.log('Checking expected foreign keys...\n');
    
    for (const { from_table, to_table, fk_name } of expectedFKs) {
      // Check if both tables are distributed
      const fromDistributed = await db.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [from_table]);
      
      const toDistributed = await db.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [to_table]);
      
      if (!fromDistributed.rows[0].distributed || !toDistributed.rows[0].distributed) {
        continue; // Skip if either table is not distributed
      }
      
      // Check if FK exists
      const fkExists = await db.raw(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_constraint 
          WHERE conname = ?
          AND conrelid = ?::regclass
        ) as exists
      `, [fk_name, from_table]);
      
      if (fkExists.rows[0].exists) {
        existingCount++;
        console.log(`✓ ${from_table} -> ${to_table} (${fk_name})`);
      } else {
        missingCount++;
        missingFKs.push({ from_table, to_table, fk_name });
        console.log(`✗ MISSING: ${from_table} -> ${to_table} (${fk_name})`);
      }
    }
    
    // Check for orphaned foreign keys (FKs that reference non-distributed tables)
    console.log('\n=== Checking for Problematic Foreign Keys ===\n');
    
    const problematicFKs = await db.raw(`
      WITH distributed_tables AS (
        SELECT logicalrelid::regclass::text as table_name
        FROM pg_dist_partition
      )
      SELECT 
        tc.table_name as from_table,
        tc.constraint_name,
        ccu.table_name as to_table,
        CASE 
          WHEN dt1.table_name IS NULL THEN 'Source not distributed'
          WHEN dt2.table_name IS NULL THEN 'Target not distributed'
          ELSE 'Both distributed'
        END as issue
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      LEFT JOIN distributed_tables dt1 ON tc.table_name = dt1.table_name
      LEFT JOIN distributed_tables dt2 ON ccu.table_name = dt2.table_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND (
          (dt1.table_name IS NOT NULL AND dt2.table_name IS NULL) OR
          (dt1.table_name IS NULL AND dt2.table_name IS NOT NULL)
        )
      ORDER BY tc.table_name, tc.constraint_name
    `);
    
    if (problematicFKs.rows.length > 0) {
      console.log('Found problematic foreign keys:');
      for (const fk of problematicFKs.rows) {
        console.log(`⚠ ${fk.from_table} -> ${fk.to_table} (${fk.constraint_name}): ${fk.issue}`);
      }
    } else {
      console.log('No problematic foreign keys found');
    }
    
    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total expected FKs checked: ${existingCount + missingCount}`);
    console.log(`Existing FKs: ${existingCount}`);
    console.log(`Missing FKs: ${missingCount}`);
    console.log(`Problematic FKs: ${problematicFKs.rows.length}`);
    
    if (missingFKs.length > 0) {
      console.log('\n=== SQL to Recreate Missing Foreign Keys ===\n');
      for (const { from_table, to_table, fk_name } of missingFKs) {
        // Determine the columns based on the FK name pattern
        const isTenantFK = fk_name.includes('_tenant_');
        if (isTenantFK) {
          const columnMatch = fk_name.match(/_tenant_(.+)_foreign$/);
          if (columnMatch) {
            const refColumn = columnMatch[1];
            console.log(`ALTER TABLE ${from_table} ADD CONSTRAINT ${fk_name}`);
            console.log(`  FOREIGN KEY (tenant, ${refColumn}) REFERENCES ${to_table}(tenant, ${refColumn})`);
            console.log(`  ON DELETE CASCADE;\n`);
          }
        }
      }
    }
    
    // Check distribution statistics
    console.log('\n=== Distribution Statistics ===\n');
    const stats = await db.raw(`
      SELECT 
        COUNT(DISTINCT logicalrelid) as distributed_tables,
        COUNT(DISTINCT CASE WHEN partmethod = 'h' THEN logicalrelid END) as hash_distributed,
        COUNT(DISTINCT CASE WHEN partmethod = 'n' THEN logicalrelid END) as reference_tables,
        COUNT(DISTINCT colocationid) as colocation_groups
      FROM pg_dist_partition
    `);
    
    console.log(`Distributed tables: ${stats.rows[0].hash_distributed}`);
    console.log(`Reference tables: ${stats.rows[0].reference_tables}`);
    console.log(`Colocation groups: ${stats.rows[0].colocation_groups}`);
    
    process.exit(missingCount > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('Error verifying foreign keys:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// Run verification
verifyForeignKeys();
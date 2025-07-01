#!/usr/bin/env ts-node
/**
 * Script to verify tag migration integrity
 * Run this after migration to ensure data consistency
 */

import { createTenantKnex } from '../src/lib/db';

async function verifyTagMigration() {
  const { knex } = await createTenantKnex();
  
  try {
    console.log('Starting tag migration verification...\n');
    
    // 1. Count comparison
    console.log('1. Verifying record counts...');
    const [{ old_count }] = await knex('tags').count('* as old_count');
    const [{ new_count }] = await knex('tag_mappings').count('* as new_count');
    const [{ def_count }] = await knex('tag_definitions').count('* as def_count');
    
    console.log(`   Old tags table: ${old_count} records`);
    console.log(`   New mappings table: ${new_count} records`);
    console.log(`   Tag definitions: ${def_count} unique tags`);
    
    if (old_count !== new_count) {
      console.error(`   ❌ Count mismatch! Expected ${old_count} mappings, found ${new_count}`);
    } else {
      console.log(`   ✓ Record counts match`);
    }
    
    // 2. Check for orphaned mappings
    console.log('\n2. Checking for orphaned mappings...');
    const orphanedMappings = await knex.raw(`
      SELECT COUNT(*) as count
      FROM tag_mappings tm
      LEFT JOIN tag_definitions td ON tm.tenant = td.tenant AND tm.tag_id = td.tag_id
      WHERE td.tag_id IS NULL
    `);
    
    if (orphanedMappings.rows[0].count > 0) {
      console.error(`   ❌ Found ${orphanedMappings.rows[0].count} orphaned mappings`);
    } else {
      console.log(`   ✓ No orphaned mappings found`);
    }
    
    // 3. Verify unique constraints
    console.log('\n3. Verifying unique constraints...');
    const duplicateDefinitions = await knex.raw(`
      SELECT tenant, tag_text, tagged_type, COUNT(*) as count
      FROM tag_definitions
      GROUP BY tenant, tag_text, tagged_type
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateDefinitions.rows.length > 0) {
      console.error(`   ❌ Found ${duplicateDefinitions.rows.length} duplicate tag definitions`);
      console.error('   Duplicates:', duplicateDefinitions.rows);
    } else {
      console.log(`   ✓ No duplicate tag definitions`);
    }
    
    // 4. Sample data verification
    console.log('\n4. Verifying sample data integrity...');
    const sampleOldTags = await knex('tags')
      .orderBy(knex.raw('RANDOM()'))
      .limit(10);
    
    let dataIntegrityPassed = true;
    for (const oldTag of sampleOldTags) {
      // Find corresponding mapping
      const mapping = await knex('tag_mappings')
        .where('mapping_id', oldTag.tag_id)
        .first();
      
      if (!mapping) {
        console.error(`   ❌ No mapping found for old tag ${oldTag.tag_id}`);
        dataIntegrityPassed = false;
        continue;
      }
      
      // Find corresponding definition
      const definition = await knex('tag_definitions')
        .where('tag_id', mapping.tag_id)
        .where('tenant', mapping.tenant)
        .first();
      
      if (!definition) {
        console.error(`   ❌ No definition found for mapping ${mapping.mapping_id}`);
        dataIntegrityPassed = false;
        continue;
      }
      
      // Verify data matches
      if (definition.tag_text.toLowerCase() !== oldTag.tag_text.toLowerCase()) {
        console.error(`   ❌ Text mismatch: "${oldTag.tag_text}" vs "${definition.tag_text}"`);
        dataIntegrityPassed = false;
      }
      
      if (mapping.tagged_id !== oldTag.tagged_id) {
        console.error(`   ❌ Tagged ID mismatch for tag ${oldTag.tag_id}`);
        dataIntegrityPassed = false;
      }
    }
    
    if (dataIntegrityPassed) {
      console.log(`   ✓ Sample data integrity verified`);
    }
    
    // 5. Performance comparison
    console.log('\n5. Performance comparison...');
    
    // Old system query
    const oldStart = Date.now();
    await knex('tags')
      .where('tenant', sampleOldTags[0]?.tenant || '')
      .where('tagged_type', 'ticket')
      .select('*');
    const oldTime = Date.now() - oldStart;
    
    // New system query
    const newStart = Date.now();
    await knex('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
            .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where('tm.tenant', sampleOldTags[0]?.tenant || '')
      .where('tm.tagged_type', 'ticket')
      .select('*');
    const newTime = Date.now() - newStart;
    
    console.log(`   Old system query time: ${oldTime}ms`);
    console.log(`   New system query time: ${newTime}ms`);
    console.log(`   Performance difference: ${((newTime - oldTime) / oldTime * 100).toFixed(1)}%`);
    
    // 6. Storage analysis
    console.log('\n6. Storage analysis...');
    const storageAnalysis = await knex.raw(`
      SELECT 
        'tags' as table_name,
        pg_size_pretty(pg_total_relation_size('tags')) as total_size,
        pg_size_pretty(pg_relation_size('tags')) as table_size,
        pg_size_pretty(pg_indexes_size('tags')) as indexes_size
      UNION ALL
      SELECT 
        'tag_definitions + tag_mappings' as table_name,
        pg_size_pretty(
          pg_total_relation_size('tag_definitions') + 
          pg_total_relation_size('tag_mappings')
        ) as total_size,
        pg_size_pretty(
          pg_relation_size('tag_definitions') + 
          pg_relation_size('tag_mappings')
        ) as table_size,
        pg_size_pretty(
          pg_indexes_size('tag_definitions') + 
          pg_indexes_size('tag_mappings')
        ) as indexes_size
    `);
    
    console.log('   Storage comparison:');
    storageAnalysis.rows.forEach((row: any) => {
      console.log(`   ${row.table_name}:`);
      console.log(`     Total: ${row.total_size}`);
      console.log(`     Table: ${row.table_size}`);
      console.log(`     Indexes: ${row.indexes_size}`);
    });
    
    console.log('\n✅ Tag migration verification complete!');
    
  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await knex.destroy();
  }
}

// Run if called directly
if (require.main === module) {
  verifyTagMigration().catch(console.error);
}

export { verifyTagMigration };
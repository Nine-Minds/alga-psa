#!/usr/bin/env npx tsx
/**
 * Tenant Management Schema Validator
 *
 * Validates that TENANT_TABLES_DELETION_ORDER in tenant-deletion-activities.ts
 * includes ALL tenant-scoped tables from the database.
 *
 * This ensures the tenant lifecycle management workflow stays in sync with
 * database schema changes as new migrations are added.
 *
 * This script:
 * 1. Reads TENANT_TABLES_DELETION_ORDER from the actual source file (not hardcoded)
 * 2. Queries the database for all tables with 'tenant' or 'tenant_id' columns
 * 3. Compares and fails if any tables are missing
 *
 * Usage:
 *   npx tsx scripts/validate-tenant-management.ts
 *
 * Environment variables:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import knex, { Knex } from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tables that are intentionally excluded from the deletion order
const EXCLUDED_TABLES: string[] = [
  'tenants',                    // The tenant table itself - deleted last separately
  'knex_migrations',            // Knex internal
  'knex_migrations_lock',       // Knex internal
  'pending_tenant_deletions',   // Managed separately in deletion workflow
  'spatial_ref_sys',            // PostGIS system table
];

interface ValidationResult {
  success: boolean;
  missingTables: string[];
  duplicatesInOrder: string[];
  tablesInDatabase: string[];
  tablesInDeletionOrder: string[];
}

/**
 * Parse the TENANT_TABLES_DELETION_ORDER array from the source file
 */
function parseDeletionOrderFromSource(): string[] {
  const projectRoot = path.resolve(__dirname, '..');
  const sourceFile = path.join(
    projectRoot,
    'ee',
    'temporal-workflows',
    'src',
    'activities',
    'tenant-deletion-activities.ts'
  );

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Source file not found: ${sourceFile}`);
  }

  const content = fs.readFileSync(sourceFile, 'utf-8');

  // Find the TENANT_TABLES_DELETION_ORDER array - match from declaration to closing ];
  const arrayMatch = content.match(
    /const\s+TENANT_TABLES_DELETION_ORDER\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\n\];/
  );

  if (!arrayMatch) {
    throw new Error('Could not find TENANT_TABLES_DELETION_ORDER array in source file');
  }

  const arrayContent = arrayMatch[1];

  // Extract all single-quoted string values from the array
  const tableNames: string[] = [];
  const stringMatches = arrayContent.matchAll(/'([a-z_]+)'/g);

  for (const match of stringMatches) {
    tableNames.push(match[1]);
  }

  if (tableNames.length === 0) {
    throw new Error('No table names found in TENANT_TABLES_DELETION_ORDER');
  }

  return tableNames;
}

/**
 * Query the database for all tables with tenant or tenant_id columns
 */
async function getTablesWithTenantColumn(db: Knex): Promise<string[]> {
  const result = await db.raw(`
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON c.table_name = t.table_name
      AND c.table_schema = t.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('tenant', 'tenant_id')
      AND c.table_name NOT LIKE 'pg_%'
      AND c.table_name NOT LIKE 'citus_%'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);

  return result.rows.map((row: { table_name: string }) => row.table_name);
}

/**
 * Create database connection
 */
function createDbConnection(): Knex {
  return knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'alga',
    },
  });
}

/**
 * Validate the deletion order against the database schema
 */
async function validateDeletionOrder(): Promise<ValidationResult> {
  console.log('Reading TENANT_TABLES_DELETION_ORDER from source file...');
  const tablesInDeletionOrder = parseDeletionOrderFromSource();
  console.log(`  Found ${tablesInDeletionOrder.length} tables in deletion order`);

  // Check for duplicates
  const seen = new Set<string>();
  const duplicatesInOrder: string[] = [];
  for (const table of tablesInDeletionOrder) {
    if (seen.has(table)) {
      duplicatesInOrder.push(table);
    }
    seen.add(table);
  }

  if (duplicatesInOrder.length > 0) {
    console.log(`  Warning: Found ${duplicatesInOrder.length} duplicate entries`);
  }

  console.log('\nConnecting to database...');
  const db = createDbConnection();

  try {
    const tablesInDatabase = await getTablesWithTenantColumn(db);
    console.log(`  Found ${tablesInDatabase.length} tables with tenant column in database`);

    // Filter out excluded tables
    const relevantDbTables = tablesInDatabase.filter(
      (t) => !EXCLUDED_TABLES.includes(t)
    );
    console.log(`  After excluding system tables: ${relevantDbTables.length} tables`);

    // Find missing tables (in database but not in deletion order)
    const deletionOrderSet = new Set(tablesInDeletionOrder);
    const missingTables = relevantDbTables.filter((t) => !deletionOrderSet.has(t));

    return {
      success: missingTables.length === 0 && duplicatesInOrder.length === 0,
      missingTables,
      duplicatesInOrder,
      tablesInDatabase: relevantDbTables,
      tablesInDeletionOrder,
    };
  } finally {
    await db.destroy();
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('========================================================================');
  console.log('  Tenant Management Schema Validator');
  console.log('========================================================================');
  console.log('');

  try {
    const result = await validateDeletionOrder();

    console.log('\n========================================================================');
    console.log('  Results');
    console.log('========================================================================');

    console.log(`\nTables in deletion order: ${result.tablesInDeletionOrder.length}`);
    console.log(`Tables with tenant column in DB: ${result.tablesInDatabase.length}`);

    if (result.duplicatesInOrder.length > 0) {
      console.log('\n❌ DUPLICATE TABLES IN DELETION ORDER:');
      result.duplicatesInOrder.forEach((t) => console.log(`   - ${t}`));
    }

    if (result.missingTables.length > 0) {
      console.log('\n❌ MISSING TABLES (exist in DB but not in deletion order):');
      result.missingTables.forEach((t) => console.log(`   - ${t}`));
      console.log('\n   These tables have a tenant column but are NOT in TENANT_TABLES_DELETION_ORDER.');
      console.log('   Add them to: ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
      console.log('\n   Consider the correct position based on foreign key dependencies:');
      console.log('   - Tables referenced by other tables should be deleted AFTER their dependents');
      console.log('   - Leaf tables (no dependencies) should be deleted first');
    }

    if (result.success) {
      console.log('\n✅ All tenant-scoped tables are included in the deletion order!');
      process.exit(0);
    } else {
      console.log('\n❌ Validation FAILED. Please fix the issues above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

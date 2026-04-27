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

// Foreign-key constraints that are exempt from the ordering check because
// breakCircularDependencies() in tenant-deletion-activities.ts NULLs out the
// referencing column before deletion begins. Add entries by constraint name.
const EXEMPT_FK_CONSTRAINTS: Set<string> = new Set([
  'statuses_tenant_board_id_fk', // NULL'd via breakCircularDependencies (statuses.board_id)
  'authorization_bundles_tenant_published_revision_id_foreign', // NULL'd via breakCircularDependencies (authorization_bundles.published_revision_id)
  'inbound_ticket_defaults_tenant_client_id_foreign', // NULL'd via breakCircularDependencies (inbound_ticket_defaults.client_id)
]);

interface FkOrderingViolation {
  childTable: string;
  parentTable: string;
  constraintName: string;
  deleteRule: string;
  childIdx: number;
  parentIdx: number;
}

interface ValidationResult {
  success: boolean;
  missingTables: string[];
  duplicatesInOrder: string[];
  tablesInDatabase: string[];
  tablesInDeletionOrder: string[];
  fkOrderingViolations: FkOrderingViolation[];
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
 * Query all foreign keys in the public schema.
 * Returns { childTable, parentTable, constraintName, deleteRule }.
 *
 * The child is the table declaring the FK; the parent is the table it references.
 * For deletion ordering, the child must be deleted BEFORE the parent (unless the
 * FK cascades or sets null on delete).
 */
interface ForeignKey {
  childTable: string;
  parentTable: string;
  constraintName: string;
  deleteRule: string;
}

async function getForeignKeys(db: Knex): Promise<ForeignKey[]> {
  const result = await db.raw(`
    SELECT DISTINCT
      tc.table_name  AS child_table,
      ccu.table_name AS parent_table,
      tc.constraint_name,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = rc.unique_constraint_name
     AND ccu.constraint_schema = rc.unique_constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name NOT LIKE 'pg_%'
      AND tc.table_name NOT LIKE 'citus_%'
      AND ccu.table_name NOT LIKE 'pg_%'
      AND ccu.table_name NOT LIKE 'citus_%'
  `);

  return result.rows.map((row: any) => ({
    childTable: row.child_table,
    parentTable: row.parent_table,
    constraintName: row.constraint_name,
    deleteRule: row.delete_rule,
  }));
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

    // === FK ordering check ===
    // For every FK between two tables that both appear in the deletion order,
    // the child (referencing) table must come BEFORE the parent (referenced)
    // table — otherwise the parent DELETE will hit the FK and fail.
    // FKs with CASCADE / SET NULL / SET DEFAULT can tolerate either order, so
    // we only enforce ordering for restrictive rules (NO ACTION, RESTRICT).
    console.log('\nChecking FK ordering...');
    const foreignKeys = await getForeignKeys(db);
    console.log(`  Found ${foreignKeys.length} foreign keys to inspect`);

    const orderIdx = new Map<string, number>();
    tablesInDeletionOrder.forEach((t, i) => {
      // First occurrence wins — duplicates are already reported separately
      if (!orderIdx.has(t)) orderIdx.set(t, i);
    });

    const fkOrderingViolations: FkOrderingViolation[] = [];
    for (const fk of foreignKeys) {
      if (fk.childTable === fk.parentTable) continue; // self-ref is fine
      if (EXEMPT_FK_CONSTRAINTS.has(fk.constraintName)) continue; // handled via NULL-out
      const childIdx = orderIdx.get(fk.childTable);
      const parentIdx = orderIdx.get(fk.parentTable);
      if (childIdx === undefined || parentIdx === undefined) continue; // outside deletion scope
      if (fk.deleteRule !== 'NO ACTION' && fk.deleteRule !== 'RESTRICT') continue;
      if (childIdx >= parentIdx) {
        fkOrderingViolations.push({
          childTable: fk.childTable,
          parentTable: fk.parentTable,
          constraintName: fk.constraintName,
          deleteRule: fk.deleteRule,
          childIdx,
          parentIdx,
        });
      }
    }

    return {
      success:
        missingTables.length === 0 &&
        duplicatesInOrder.length === 0 &&
        fkOrderingViolations.length === 0,
      missingTables,
      duplicatesInOrder,
      tablesInDatabase: relevantDbTables,
      tablesInDeletionOrder,
      fkOrderingViolations,
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
      console.log('\n   ⚠️  IMPORTANT: After adding missing tables, a new Temporal deployment is required');
      console.log('   to pick up the updated deletion order.');
    }

    if (result.fkOrderingViolations.length > 0) {
      console.log('\n❌ FK ORDERING VIOLATIONS (parent referenced by child but deleted first):');
      for (const v of result.fkOrderingViolations) {
        console.log(
          `   - ${v.childTable} (idx ${v.childIdx}) must be deleted BEFORE ${v.parentTable} (idx ${v.parentIdx})`
        );
        console.log(`       constraint: ${v.constraintName}, ON DELETE ${v.deleteRule}`);
      }
      console.log('\n   These FKs have restrictive ON DELETE (NO ACTION/RESTRICT), so the DELETE on');
      console.log('   the parent row will fail while child rows still reference it. Move the child');
      console.log('   table to an earlier position than the parent in TENANT_TABLES_DELETION_ORDER.');
      console.log('\n   (CASCADE and SET NULL FKs are allowed in either order and are not flagged.)');
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

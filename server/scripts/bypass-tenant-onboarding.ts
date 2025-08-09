#!/usr/bin/env node

/**
 * CLI script to bypass tenant onboarding by setting onboarding_skipped flag to true
 * for all tenant records in the tenant_settings table
 */

import knex from 'knex';
import { parse } from 'ts-command-line-args';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  tenant?: string;
  dryRun?: boolean;
  help?: boolean;
}

const args = parse<Args>(
  {
    tenant: { type: String, optional: true, description: 'Specific tenant ID to update (optional, updates all if not provided)' },
    dryRun: { type: Boolean, optional: true, alias: 'd', description: 'Preview changes without applying them' },
    help: { type: Boolean, optional: true, alias: 'h', description: 'Show help' }
  },
  {
    helpArg: 'help',
    headerContentSections: [
      {
        header: 'Bypass Tenant Onboarding',
        content: 'Sets onboarding_skipped flag to true for tenant records in tenant_settings table'
      }
    ],
    argv: process.argv.slice(2)
  }
);

async function main() {
  // Create database connection
  // For local development, use localhost instead of Docker service names
  const isDocker = process.env.DOCKER_ENV === 'true';
  const dbHost = isDocker ? (process.env.PGBOUNCER_HOST || 'pgbouncer') : 'localhost';
  const dbPort = isDocker ? (process.env.PGBOUNCER_PORT || '6432') : '5432';
  
  // Try to read password from secrets file if available
  let dbPassword = process.env.DB_PASSWORD_ADMIN || process.env.POSTGRES_PASSWORD || 'abcd1234!';
  try {
    const fs = await import('fs');
    const secretsPath = path.resolve(__dirname, '../../secrets/postgres_password');
    if (fs.existsSync(secretsPath)) {
      dbPassword = fs.readFileSync(secretsPath, 'utf8').trim();
    }
  } catch (error) {
    // Fall back to environment variables
  }
  
  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: parseInt(dbPort),
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER || 'postgres',
      password: dbPassword
    }
  });

  try {
    console.log('🔍 Checking tenant_settings table...\n');

    // Build query conditions
    let query = db('tenant_settings');
    
    if (args.tenant) {
      query = query.where('tenant', args.tenant);
      console.log(`📋 Targeting specific tenant: ${args.tenant}`);
    } else {
      console.log('📋 Targeting all tenants');
    }

    // Get current state
    const currentRecords = await query.select('tenant', 'onboarding_skipped', 'onboarding_completed');
    
    if (currentRecords.length === 0) {
      console.log('⚠️  No tenant_settings records found');
      if (args.tenant) {
        console.log(`   Tenant '${args.tenant}' may not exist`);
      }
      return;
    }

    console.log(`\n📊 Found ${currentRecords.length} tenant_settings record(s):`);
    console.log('┌─────────────────────────────────────────┬─────────────────────┬────────────────────┐');
    console.log('│ Tenant ID                               │ Onboarding Skipped  │ Onboarding Complete│');
    console.log('├─────────────────────────────────────────┼─────────────────────┼────────────────────┤');
    
    currentRecords.forEach(record => {
      const tenantId = record.tenant.padEnd(39);
      const skipped = (record.onboarding_skipped ? 'true' : 'false').padEnd(19);
      const completed = (record.onboarding_completed ? 'true' : 'false').padEnd(18);
      console.log(`│ ${tenantId} │ ${skipped} │ ${completed} │`);
    });
    
    console.log('└─────────────────────────────────────────┴─────────────────────┴────────────────────┘');

    // Filter records that need updating
    const recordsToUpdate = currentRecords.filter(record => !record.onboarding_skipped);
    
    if (recordsToUpdate.length === 0) {
      console.log('\n✅ All tenant records already have onboarding_skipped=true');
      return;
    }

    console.log(`\n🎯 ${recordsToUpdate.length} record(s) need to be updated:`);
    recordsToUpdate.forEach(record => {
      console.log(`   • ${record.tenant} (currently: onboarding_skipped=${record.onboarding_skipped})`);
    });

    if (args.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made');
      console.log('   Run without --dry-run to apply changes');
      return;
    }

    // Apply updates
    console.log('\n🔧 Updating tenant_settings records...');
    
    const updateQuery = db('tenant_settings')
      .update({
        onboarding_skipped: true,
        updated_at: db.fn.now()
      });

    if (args.tenant) {
      updateQuery.where('tenant', args.tenant);
    }

    // Only update records where onboarding_skipped is currently false
    updateQuery.where('onboarding_skipped', false);

    const updatedCount = await updateQuery;

    console.log(`\n✅ Successfully updated ${updatedCount} tenant_settings record(s)`);
    console.log('   All targeted tenants now have onboarding_skipped=true');

    // Verify the changes
    const verifyRecords = await db('tenant_settings')
      .select('tenant', 'onboarding_skipped', 'updated_at')
      .where(args.tenant ? { tenant: args.tenant } : {})
      .orderBy('updated_at', 'desc');

    console.log('\n📋 Final state verification:');
    verifyRecords.forEach(record => {
      const timestamp = new Date(record.updated_at).toISOString();
      console.log(`   • ${record.tenant}: onboarding_skipped=${record.onboarding_skipped} (updated: ${timestamp})`);
    });

  } catch (error) {
    console.error('\n❌ Failed to update tenant onboarding settings:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
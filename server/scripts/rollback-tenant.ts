#!/usr/bin/env node

/**
 * CLI script to rollback/delete a tenant
 */

import { rollbackTenant } from '@ee/lib/testing/tenant-creation';
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
  tenantId: string;
  help?: boolean;
}

const args = parse<Args>(
  {
    tenantId: { type: String, description: 'Tenant ID to rollback/delete' },
    help: { type: Boolean, optional: true, alias: 'h', description: 'Show help' }
  },
  {
    helpArg: 'help',
    headerContentSections: [
      {
        header: 'Rollback Tenant',
        content: 'Deletes a tenant and all associated data'
      }
    ]
  }
);

async function main() {
  // Create database connection
  // For local development, use localhost instead of Docker service names
  const isDocker = process.env.DOCKER_ENV === 'true';
  const dbHost = isDocker ? (process.env.PGBOUNCER_HOST || 'pgbouncer') : 'localhost';
  const dbPort = isDocker ? (process.env.PGBOUNCER_PORT || '6432') : '5432';
  
  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: parseInt(dbPort),
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || process.env.POSTGRES_PASSWORD || 'abcd1234!'
    }
  });

  try {
    await rollbackTenant(db, args.tenantId);
    console.log('\n✅ Tenant rolled back successfully!');
  } catch (error) {
    console.error('\n❌ Failed to rollback tenant:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();

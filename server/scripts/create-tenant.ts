#!/usr/bin/env node

/**
 * CLI script to create a new tenant with onboarding seeds
 */

import { createTenantComplete } from '@enterprise/lib/testing/tenant-creation';
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
  tenant: string;
  email: string;
  firstName?: string;
  lastName?: string;
  clientName?: string;
  companyName?: string;
  password?: string;
  help?: boolean;
}

const args = parse<Args>(
  {
    tenant: { type: String, description: 'Tenant name' },
    email: { type: String, description: 'Admin user email' },
    firstName: { type: String, optional: true, defaultValue: 'Admin', description: 'Admin first name' },
    lastName: { type: String, optional: true, defaultValue: 'User', description: 'Admin last name' },
    clientName: { type: String, optional: true, description: 'Client name (defaults to tenant name)' },
    companyName: { type: String, optional: true, description: 'Company name (defaults to tenant name)' },
    password: { type: String, optional: true, description: 'Admin password (generated if not provided)' },
    help: { type: Boolean, optional: true, alias: 'h', description: 'Show help' }
  },
  {
    helpArg: 'help',
    headerContentSections: [
      {
        header: 'Create Tenant',
        content: 'Creates a new tenant with an admin user'
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
    const resolvedCompanyName = args.companyName ?? args.clientName ?? args.tenant;
    const resolvedClientName = args.clientName ?? args.companyName ?? args.tenant;

    const result = await createTenantComplete(db, {
      tenantName: args.tenant,
      adminUser: {
        firstName: args.firstName || 'Admin',
        lastName: args.lastName || 'User',
        email: args.email
      },
      companyName: resolvedCompanyName,
      clientName: resolvedClientName
    });

    console.log('\n✅ Tenant created successfully!');
    console.log(`Tenant ID: ${result.tenantId}`);
    console.log(`Admin User ID: ${result.adminUserId}`);
    console.log(`Client ID: ${result.clientId}`);
    console.log(`Admin Email: ${args.email}`);
    console.log(`Temporary Password: ${result.temporaryPassword}`);

  } catch (error) {
    console.error('\n❌ Failed to create tenant:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();

#!/usr/bin/env node

/**
 * CLI script to create a new tenant with onboarding seeds
 */

// Imported as a namespace with a default fallback: under tsx the module is
// loaded as CommonJS, so the named export isn't statically visible to an ESM
// importer — the real exports live on the module's default (module.exports).
// This form resolves correctly whether the module is loaded as CJS or ESM.
import * as tenantCreationModule from '../../ee/server/src/lib/testing/tenant-creation';
const { createTenantComplete } = ((tenantCreationModule as { default?: typeof tenantCreationModule }).default ?? tenantCreationModule);
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
  productCode?: string;
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
    productCode: { type: String, optional: true, description: 'Product code: psa (default) or algadesk' },
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
  const dbHost = process.env.DB_HOST || (isDocker ? (process.env.PGBOUNCER_HOST || 'pgbouncer') : 'localhost');
  const dbPort = process.env.DB_PORT || (isDocker ? (process.env.PGBOUNCER_PORT || '6432') : '5432');
  
  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: parseInt(dbPort),
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_ADMIN || process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || process.env.DB_PASSWORD_SUPERUSER || process.env.POSTGRES_PASSWORD || 'abcd1234!'
    }
  });

  try {
    const resolvedCompanyName = args.companyName ?? args.clientName ?? args.tenant;
    const resolvedClientName = args.clientName ?? args.companyName ?? args.tenant;

    let productCode: 'psa' | 'algadesk' | undefined;
    if (args.productCode !== undefined) {
      if (args.productCode !== 'psa' && args.productCode !== 'algadesk') {
        throw new Error(`Invalid productCode "${args.productCode}". Must be "psa" or "algadesk".`);
      }
      productCode = args.productCode;
    }

    const suppliedPassword = args.password ?? process.env.INITIAL_ADMIN_PASSWORD;

    const result = await createTenantComplete(db, {
      tenantName: args.tenant,
      adminUser: {
        firstName: args.firstName || 'Admin',
        lastName: args.lastName || 'User',
        email: args.email,
        password: suppliedPassword
      },
      companyName: resolvedCompanyName,
      clientName: resolvedClientName,
      productCode
    });

    // Put the new tenant into the onboarding-pending state so the admin lands in
    // the in-app onboarding wizard on first login. createTenantComplete (the
    // testing/CLI tenant path) does not create a tenant_settings row the way the
    // SaaS provisioning path does, so without this the OnboardingProvider redirect
    // (which requires onboarding_completed=false AND onboarding_skipped=false)
    // never fires. Idempotent + best-effort so it never blocks tenant creation.
    try {
      const now = new Date();
      await db('tenant_settings')
        .insert({
          tenant: result.tenantId,
          onboarding_completed: false,
          onboarding_skipped: false,
          onboarding_data: null,
          settings: null,
          created_at: now,
          updated_at: now
        })
        .onConflict('tenant')
        .ignore();
      console.log('Onboarding: tenant_settings initialized (onboarding pending)');
    } catch (settingsError) {
      console.warn('Warning: failed to initialize tenant_settings for onboarding:', settingsError);
    }

    console.log('\n✅ Tenant created successfully!');
    console.log(`Tenant ID: ${result.tenantId}`);
    console.log(`Admin User ID: ${result.adminUserId}`);
    console.log(`Client ID: ${result.clientId}`);
    console.log(`Admin Email: ${args.email}`);
    console.log(`Product Code: ${productCode ?? '(default)'}`);
    if (suppliedPassword) {
      console.log('Admin Password: [provided]');
    } else {
      console.log(`Temporary Password: ${result.temporaryPassword}`);
    }

  } catch (error) {
    console.error('\n❌ Failed to create tenant:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();

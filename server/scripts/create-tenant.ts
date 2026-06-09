#!/usr/bin/env node

/**
 * CLI script to create a new tenant with onboarding seeds
 */

import knex from 'knex';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tenant-creation lives in the ee/server (CommonJS) package; importing it with
// a named ESM import across the package boundary fails under tsx in the
// production image ("does not provide an export named 'createTenantComplete'"),
// because esbuild transpiles it to CJS. require() it via the CJS interop so the
// appliance bootstrap (npx tsx create-tenant.ts) resolves the export.
const require = createRequire(import.meta.url);
const { createTenantComplete } =
  require('../../ee/server/src/lib/testing/tenant-creation') as typeof import('../../ee/server/src/lib/testing/tenant-creation');

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
  tenantId?: string;
  help?: boolean;
}

const HELP = `Create Tenant — creates a new tenant with an admin user

Usage: create-tenant --tenant <name> --email <email> [options]

Options:
  --tenant       Tenant name (required)
  --email        Admin user email (required)
  --firstName    Admin first name (default: Admin)
  --lastName     Admin last name (default: User)
  --clientName   Client name (defaults to tenant name)
  --companyName  Company name (defaults to tenant name)
  --password     Admin password (generated if not provided)
  --productCode  Product code: psa (default) or algadesk
  --tenantId     Pre-minted tenant id to adopt (else env INITIAL_TENANT_ID; else DB-generated)
  -h, --help     Show help
`;

// Minimal --key value / --flag parser (process.argv). Deliberately avoids
// ts-command-line-args, which is a devDependency and therefore absent from the
// --omit=dev production image the appliance bootstrap runs this script in.
function parseArgs(argv: string[]): Args {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-h' || token === '--help') {
      out.help = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out as unknown as Args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (!args.tenant || !args.email) {
  console.error('Error: --tenant and --email are required.\n');
  console.error(HELP);
  process.exit(1);
}

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
    // Adopt a pre-minted tenant id when the appliance install provides one (the
    // registry-minted id redeemed from the install code); otherwise the DB mints it.
    const initialTenantId = args.tenantId ?? process.env.INITIAL_TENANT_ID;

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
      productCode,
      tenantId: initialTenantId
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
    console.log(`Tenant ID: ${result.tenantId}${initialTenantId ? ' (adopted from INITIAL_TENANT_ID)' : ''}`);
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

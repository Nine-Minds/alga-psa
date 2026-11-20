#!/usr/bin/env tsx
/**
 * Move legacy plaintext outbound email secrets (SMTP password, Resend API key)
 * from tenant_email_settings.provider_configs into the tenant secret provider.
 *
 * Run inside a server pod so it uses that pod's secret-provider configuration:
 *   npx tsx scripts/backfill-tenant-email-secrets.ts [--dry-run] [--tenant <id>]
 *
 * Tenants are processed one at a time (Vault tenant writes are read-merge-write).
 * Output is counts and field labels only, never values. Exits non-zero if any
 * tenant fails.
 */

import knex from 'knex';
import { createRequire } from 'module';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { migrateTenantProviderSecrets } from '@alga-psa/email/providerSecrets';

const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

type TenantRecord = { tenant: string };

function parseArgs(argv: string[]): { dryRun: boolean; tenant?: string } {
  const dryRun = argv.includes('--dry-run');
  const tenantIndex = argv.indexOf('--tenant');
  const tenant = tenantIndex >= 0 ? argv[tenantIndex + 1] : undefined;
  if (tenantIndex >= 0 && (!tenant || tenant.startsWith('--'))) {
    throw new Error('--tenant requires a tenant id');
  }
  return { dryRun, tenant };
}

async function run() {
  const { dryRun, tenant: onlyTenant } = parseArgs(process.argv.slice(2));
  const environment = process.env.NODE_ENV || 'development';
  const knexInstance = knex(knexConfig[environment]);
  let failed = 0;
  let migratedTenants = 0;
  let migratedFields = 0;
  let skippedConcurrent = 0;

  try {
    const secretProvider = await getSecretProviderInstance();
    const rows = onlyTenant
      ? [{ tenant: onlyTenant }]
      : await knexInstance<TenantRecord>('tenant_email_settings').select('tenant');

    console.log(`${dryRun ? '[dry-run] ' : ''}Scanning ${rows.length} tenant(s) for plaintext outbound email secrets.`);

    for (const { tenant } of rows) {
      try {
        const result = await migrateTenantProviderSecrets(knexInstance, tenant, secretProvider, { dryRun });
        if (result.skipped === 'concurrent') skippedConcurrent += 1;
        if (result.migrated.length > 0) {
          migratedTenants += 1;
          migratedFields += result.migrated.length;
        }
        if (result.migrated.length > 0 || result.skipped === 'concurrent') {
          console.log(
            `[tenant=${tenant}] ${dryRun ? 'would_migrate' : 'migrated'}=${result.migrated.join(',') || '-'}` +
              (result.skipped ? ` skipped=${result.skipped}` : ''),
          );
        }
      } catch (error) {
        failed += 1;
        // Message only: errors from the secret store can name paths but never carry values.
        console.error(`[tenant=${tenant}] FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    console.log(
      `Done. tenants_with_plaintext=${migratedTenants} fields=${migratedFields} skipped_concurrent=${skippedConcurrent} failed=${failed}`,
    );
    if (skippedConcurrent > 0) console.log('Some tenants saved concurrently and were skipped; re-run to retry them.');
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('Tenant email secrets backfill failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await knexInstance.destroy();
  }
}

run();

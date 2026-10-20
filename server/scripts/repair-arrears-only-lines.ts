#!/usr/bin/env vite-node
/**
 * Post-deploy repair for Hourly/Usage lines that used to bill in advance
 * (card alga-2026-0002697). Run AFTER Migration A
 * (20261013120000_hourly_usage_lines_bill_in_arrears) has been applied.
 *
 * For each tenant, inside ONE transaction per tenant:
 *   1. repairArrearsOnlyLineSchedulesForTenant   (retire advance periods, add arrears catch-up rows)
 *   2. repairAllClientCadenceServicePeriodsForTenant (re-materialise cadence ledgers)
 *
 * Usage:
 *   cd server && npx vite-node --config vitest.config.ts scripts/repair-arrears-only-lines.ts [--tenant=<id>]... [--dry-run]
 *
 *   (vite-node, not tsx: the @alga-psa/* workspace packages are ESM/webpack-targeted and
 *   plain tsx cannot load them. vite-node uses the same aliases as the integration tests.)
 *
 *   --tenant=<id>  Repeatable. Limit to these tenants. Without it, every tenant that has
 *                  an Hourly/Usage line with advance timing (plan Q1) or an advance
 *                  recurring_service_period on an Hourly/Usage line (plan Q2).
 *   --dry-run      Runs the full repair inside the transaction, prints the summary, then
 *                  ROLLS BACK. Nothing is written.
 *
 * Citus: every query is filtered by tenant (tenantDb facade); discovery is a
 * per-table scan with no cross-tenant join. Each tenant's work is a single-tenant transaction.
 */

import knexFactory, { Knex } from 'knex';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { tenantDb } from '@alga-psa/db';
import { repairArrearsOnlyLineSchedulesForTenant } from '@alga-psa/billing/actions/arrearsOnlyLineRepair';
import { repairAllClientCadenceServicePeriodsForTenant } from '@alga-psa/shared/billingClients';

const require = createRequire(import.meta.url);
const knexfilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../knexfile.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require(knexfilePath);

class Rollback extends Error {}

function parseArgs(argv: string[]): { tenants: string[]; dryRun: boolean } {
  const tenants: string[] = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--tenant=')) {
      const id = arg.slice('--tenant='.length).trim();
      if (!id) throw new Error('--tenant requires a value');
      tenants.push(id);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { tenants: [...new Set(tenants)], dryRun };
}

/** Plan Q1 + Q2 as tenant discovery: single-table scans, grouped by tenant. */
async function discoverTenants(db: Knex): Promise<string[]> {
  const found = new Set<string>();
  const q1 = await db('contract_lines')
    .whereIn('contract_line_type', ['Hourly', 'Usage'])
    .where('billing_timing', 'advance')
    .distinct('tenant');
  q1.forEach((r: { tenant: string }) => found.add(r.tenant));

  // Q2 without the join: advance periods, then resolve line type per tenant (tenant-filtered).
  const periodTenants = await db('recurring_service_periods')
    .where('due_position', 'advance')
    .distinct('tenant');
  for (const { tenant } of periodTenants as Array<{ tenant: string }>) {
    if (found.has(tenant)) continue;
    const hit = await tenantDb(db, tenant)
      .table('recurring_service_periods as rsp')
      .join('contract_lines as cl', function (this: Knex.JoinClause) {
        this.on('cl.tenant', 'rsp.tenant').andOn('cl.contract_line_id', 'rsp.obligation_id');
      })
      .where('rsp.due_position', 'advance')
      .whereIn('cl.contract_line_type', ['Hourly', 'Usage'])
      .first('rsp.tenant');
    if (hit) found.add(tenant);
  }
  return [...found].sort();
}

async function main(): Promise<void> {
  const { tenants: requested, dryRun } = parseArgs(process.argv.slice(2));
  const db = knexFactory(knexConfig[process.env.NODE_ENV || 'development']);
  const failures: string[] = [];
  try {
    const tenants = requested.length > 0 ? requested : await discoverTenants(db);
    console.log(
      `${dryRun ? '[DRY RUN - will roll back] ' : ''}Repairing ${tenants.length} tenant(s): ${tenants.join(', ') || '(none)'}`
    );

    for (const tenant of tenants) {
      try {
        let result: unknown;
        try {
          await db.transaction(async (trx) => {
            const arrearsOnlyLines = await repairArrearsOnlyLineSchedulesForTenant(trx, { tenant });
            const clientCadence = await repairAllClientCadenceServicePeriodsForTenant(trx, { tenant });
            result = { arrearsOnlyLines, clientCadence };
            if (dryRun) throw new Rollback();
          });
        } catch (error) {
          if (!(error instanceof Rollback)) throw error;
        }
        console.log(`\n=== tenant ${tenant} ${dryRun ? '(dry run, rolled back)' : '(committed)'} ===`);
        console.log(JSON.stringify(result, null, 2));
        const manual = (result as any)?.arrearsOnlyLines?.manualReview ?? [];
        if (manual.length > 0) {
          console.log(`!! ${manual.length} item(s) need MANUAL REVIEW for tenant ${tenant}`);
        }
      } catch (error) {
        failures.push(tenant);
        console.error(`\n=== tenant ${tenant} FAILED (transaction rolled back) ===`);
        console.error(error);
      }
    }
  } finally {
    await db.destroy();
  }
  if (failures.length > 0) {
    console.error(`\nFailed tenants: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

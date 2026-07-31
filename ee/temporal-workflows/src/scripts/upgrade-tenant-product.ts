#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { destroyAdminConnection } from '@alga-psa/db/admin.js';
import {
  runProductUpgrade,
  type ProductUpgradeDryRunPlan,
} from '../db/product-upgrade-operations.js';
import type { SeedRunLog } from '../db/onboarding-seeds-operations.js';

dotenv.config();

interface CliArgs {
  tenant?: string;
  dryRun: boolean;
  skipStripe: boolean;
  flip: boolean;
  help: boolean;
}

const USAGE = `Upgrade an AlgaDesk tenant to AlgaPSA

Usage: npm run upgrade:tenant-product -- --tenant <uuid> <mode>

Required:
  --tenant <uuid>  Tenant to upgrade

Choose exactly one mode:
  --dry-run        Inspect the tenant and print the no-write upgrade plan
  --skip-stripe    Apply DB backfill phases, but withhold the product-code flip
  --flip           After the Stripe swap, flip product_code and verify

Other:
  -h, --help       Show this help
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    skipStripe: false,
    flip: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--tenant': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--tenant requires a UUID value');
        }
        args.tenant = value;
        index += 1;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--skip-stripe':
        args.skipStripe = true;
        break;
      case '--flip':
        args.flip = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function validateArgs(args: CliArgs): asserts args is CliArgs & { tenant: string } {
  if (!args.tenant) {
    throw new Error('--tenant <uuid> is required');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.tenant)) {
    throw new Error(`Invalid tenant UUID: ${args.tenant}`);
  }

  const selectedModes = [args.dryRun, args.skipStripe, args.flip].filter(Boolean).length;
  if (selectedModes === 0) {
    throw new Error('Refusing to run without an explicit mode');
  }
  if (selectedModes > 1) {
    throw new Error('--dry-run, --skip-stripe, and --flip are mutually exclusive');
  }
}

function metaSuffix(meta?: Record<string, unknown>): string {
  return meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
}

const log: SeedRunLog = {
  info: (message, meta) => console.log(`[info] ${message}${metaSuffix(meta)}`),
  error: (message, meta) => console.error(`[error] ${message}${metaSuffix(meta)}`),
};

function printDryRunPlan(plan: ProductUpgradeDryRunPlan): void {
  console.log('\nDry-run plan (no writes performed)');
  console.log(`Tenant: ${plan.tenant.tenantId}`);
  console.log(`Name: ${plan.tenant.clientName ?? '(unnamed)'}`);
  console.log(`Current product_code: ${plan.tenant.productCode ?? 'null'}`);
  console.log('\nPSA seed files that would run:');
  for (const seedFile of plan.seedFilesWouldRun) {
    console.log(`  - ${seedFile}`);
  }
  console.log('\nRequired PSA roles:');
  for (const role of plan.roles) {
    console.log(`  - ${role.scope}/${role.roleName}: ${role.exists ? 'exists' : 'missing'}`);
  }
  console.log('\nRBAC grants that would be inserted from current tenant state:');
  for (const role of plan.rolePermissionInserts) {
    console.log(
      `  - ${role.scope}/${role.roleName}: ${role.rowsWouldInsert}`
      + ` (${role.skippedUnknownKeys} unknown grant keys skipped)`,
    );
  }
  console.log(`\nUsers needing Technician: ${plan.usersNeedingTechnicianRole}`);
  console.log(`Clients missing tax settings: ${plan.clientsMissingTaxSettings}`);
  console.log(`ITIL boards missing SLA: ${plan.itilBoardsMissingSla}`);
  console.log(`\nActive tax rate: ${plan.activeTaxRateExists ? 'exists' : 'missing'}`);
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(USAGE);
      return;
    }
    validateArgs(args);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runProductUpgrade(args.tenant, {
      dryRun: args.dryRun,
      skipStripe: args.skipStripe,
      flipOnly: args.flip,
      log,
    });

    if (result.mode === 'dry-run') {
      printDryRunPlan(result);
    } else if (result.mode === 'staged') {
      console.log(`\nApplied seed files: ${result.seedsApplied.join(', ') || '(none)'}`);
      console.log('Stripe swap and product_code flip remain pending.');
      console.log('Run again with --flip after the Stripe swap.');
    } else {
      console.log(`\nTenant ${args.tenant} was flipped to psa and verified successfully.`);
    }
  } catch (error) {
    console.error(`\nUpgrade failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await destroyAdminConnection();
  }
}

void main();

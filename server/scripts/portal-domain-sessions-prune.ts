#!/usr/bin/env tsx
import { pruneExpiredPortalDomainOtts } from 'server/src/lib/models/PortalDomainSessionToken';
import { getAdminConnection } from '@alga-psa/db/admin';

interface CliOptions {
  tenant?: string;
  olderThanMinutes: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let tenant: string | undefined;
  let olderThanMinutes = 10;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tenant' && index + 1 < argv.length) {
      tenant = argv[index + 1];
      index += 1;
    } else if ((arg === '--older-than-minutes' || arg === '--minutes') && index + 1 < argv.length) {
      const parsed = Number(argv[index + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        olderThanMinutes = parsed;
      }
      index += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { tenant, olderThanMinutes, dryRun };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - options.olderThanMinutes * 60_000);

  await getAdminConnection();

  const count = await pruneExpiredPortalDomainOtts({
    tenant: options.tenant,
    before: cutoff,
    dryRun: options.dryRun,
  });

  const scope = options.tenant ? `tenant ${options.tenant}` : 'all tenants';
  const label = `${options.olderThanMinutes} minute(s)`;

  if (options.dryRun) {
    console.log(`DRY RUN: Found ${count} portal domain session OTT record(s) older than ${label} for ${scope}.`);
  } else {
    console.log(`Pruned ${count} portal domain session OTT record(s) older than ${label} for ${scope}.`);
  }
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Failed to prune portal domain session OTTs', error);
  process.exit(1);
});

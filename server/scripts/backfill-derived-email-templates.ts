#!/usr/bin/env tsx
/**
 * Stamp derived-template provenance on tenant email templates the branding tool wrote before
 * provenance existed (alga-2026-0002820), so they follow the current system template from then on.
 * Rows that are exact renderings of the current system body or a catalogued prior body (palette +
 * brand decoration) are stamped; every other row is left untouched. Counts and the
 * (tenant, template, language) triples stamped are printed, never template content.
 *
 * Idempotent: rows that already carry provenance are never read again, and a finished tenant is
 * marked in tenant_settings (settings.emailTemplateProvenanceBackfill) and skipped on a re-run.
 *
 * Run after the 20261123090000 migration, inside a server pod. Dry run first:
 *   npx tsx scripts/backfill-derived-email-templates.ts --dry-run [--tenant <id>]
 *   npx tsx scripts/backfill-derived-email-templates.ts [--tenant <id>] [--force]
 *
 * To refresh the catalogue of prior bodies after a system template change that old rows must
 * still be recognised against: node scripts/generate-prior-email-template-bodies.cjs
 */

import knex from 'knex';
import { createRequire } from 'module';
import { backfillDerivedTemplates } from '@alga-psa/email/backfillDerivedTemplates';

const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function run() {
  const argv = process.argv.slice(2);
  const knexInstance = knex(knexConfig[process.env.NODE_ENV || 'development']);
  try {
    const summary = await backfillDerivedTemplates(knexInstance, {
      tenant: option(argv, '--tenant'),
      dryRun: argv.includes('--dry-run'),
      force: argv.includes('--force'),
      onProgress: (line) => console.log(line),
    });
    console.log(
      `done: tenants=${summary.tenants.length} considered=${summary.considered} stamped=${summary.stamped} unmatched=${summary.unmatched}${argv.includes('--dry-run') ? ' (dry run, nothing written)' : ''}`,
    );
  } finally {
    await knexInstance.destroy();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

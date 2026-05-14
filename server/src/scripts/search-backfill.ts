#!/usr/bin/env tsx

import knexFactory, { type Knex } from 'knex';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const knexfilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../knexfile.cjs');
const knexConfig = require(knexfilePath);

interface TenantRecord {
  tenant: string;
}

export interface SearchBackfillOptions {
  tenant?: string;
  type?: string;
}

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length) || undefined;
  }

  const index = argv.indexOf(`--${name}`);
  if (index >= 0) {
    return argv[index + 1];
  }

  return undefined;
}

export function parseSearchBackfillArgs(argv: string[]): SearchBackfillOptions {
  return {
    tenant: readFlag(argv, 'tenant'),
    type: readFlag(argv, 'type'),
  };
}

function createBackfillKnex(): Knex {
  const environment = process.env.NODE_ENV || 'development';
  return knexFactory(knexConfig[environment]);
}

export async function resolveBackfillTenants(
  knex: Knex,
  options: SearchBackfillOptions,
): Promise<string[]> {
  if (options.tenant) {
    return [options.tenant];
  }

  const rows = await knex<TenantRecord>('tenants')
    .select('tenant')
    .orderBy('tenant', 'asc');

  return rows.map((row) => row.tenant);
}

export async function runSearchBackfill(
  options: SearchBackfillOptions,
  existingKnex?: Knex,
): Promise<void> {
  const knex = existingKnex ?? createBackfillKnex();
  const ownsConnection = !existingKnex;

  try {
    const tenants = await resolveBackfillTenants(knex, options);
    console.log(`Search backfill selected ${tenants.length} tenant(s).`);
    for (const tenant of tenants) {
      console.log(`[tenant=${tenant}] backfill selection ready`);
    }
  } finally {
    if (ownsConnection) {
      await knex.destroy();
    }
  }
}

async function main(): Promise<void> {
  const options = parseSearchBackfillArgs(process.argv.slice(2));
  await runSearchBackfill(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Search backfill failed', error);
    process.exitCode = 1;
  });
}

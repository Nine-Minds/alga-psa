#!/usr/bin/env tsx

import knexFactory, { type Knex } from 'knex';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { ceIndexers } from '@alga-psa/search/indexers';
import { upsertSearchDoc } from '@alga-psa/search/upsert';
import type { EntityIndexer } from '@alga-psa/types';

async function loadAllIndexers(): Promise<EntityIndexer[]> {
  let ee: EntityIndexer[] = [];
  try {
    const mod = await import('@ee/lib/search/indexers');
    const exported = (mod as { eeIndexers?: EntityIndexer[]; default?: { eeIndexers?: EntityIndexer[] } });
    ee = exported.eeIndexers ?? exported.default?.eeIndexers ?? [];
  } catch {
    ee = [];
  }
  return [...ceIndexers, ...ee];
}

async function findIndexer(type: string): Promise<EntityIndexer | undefined> {
  const list = await loadAllIndexers();
  return list.find((indexer) => indexer.objectType === type);
}

const require = createRequire(import.meta.url);
const knexfilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../knexfile.cjs');
const knexConfig = require(knexfilePath);
const BACKFILL_BATCH_SIZE = 500;

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

export async function resolveBackfillIndexers(options: SearchBackfillOptions): Promise<EntityIndexer[]> {
  if (!options.type) {
    return loadAllIndexers();
  }

  const indexer = await findIndexer(options.type);
  if (!indexer) {
    throw new Error(`Unknown search object_type "${options.type}"`);
  }

  return [indexer];
}

export async function upsertBackfillBatches(
  knex: Knex,
  tenant: string,
  indexer: EntityIndexer,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  while (true) {
    const docs = await indexer.loadBatch(knex, tenant, cursor, BACKFILL_BATCH_SIZE);
    if (docs.length === 0) {
      break;
    }

    total += docs.length;
    for (const doc of docs) {
      await upsertSearchDoc(knex, doc);
    }

    cursor = docs[docs.length - 1]?.objectId ?? cursor;
    console.log(
      `[tenant=${tenant}] [type=${indexer.objectType}] upserted batch size=${docs.length} total=${total}`,
    );

    if (docs.length < BACKFILL_BATCH_SIZE) {
      break;
    }
  }

  return total;
}

export async function runSearchBackfill(
  options: SearchBackfillOptions,
  existingKnex?: Knex,
): Promise<void> {
  const knex = existingKnex ?? createBackfillKnex();
  const ownsConnection = !existingKnex;

  try {
    const tenants = await resolveBackfillTenants(knex, options);
    const indexers = await resolveBackfillIndexers(options);
    console.log(`Search backfill selected ${tenants.length} tenant(s).`);
    console.log(`Search backfill selected ${indexers.length} indexer(s).`);
    const failures: Array<{ tenant: string; type: string; message: string }> = [];
    let tenantIndex = 0;
    for (const tenant of tenants) {
      tenantIndex += 1;
      const startedAt = Date.now();
      console.log(`=== [${tenantIndex}/${tenants.length}] tenant ${tenant} — start ===`);
      let tenantRows = 0;
      let tenantFailed = 0;
      for (const indexer of indexers) {
        try {
          const total = await upsertBackfillBatches(knex, tenant, indexer);
          tenantRows += total;
          console.log(`[tenant=${tenant}] [type=${indexer.objectType}] upserted ${total} search row(s)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          tenantFailed += 1;
          failures.push({ tenant, type: indexer.objectType, message });
          console.error(`[tenant=${tenant}] [type=${indexer.objectType}] FAILED: ${message}`);
        }
      }
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `=== [${tenantIndex}/${tenants.length}] tenant ${tenant} — done: ${tenantRows} row(s), `
        + `${tenantFailed} indexer failure(s), ${elapsedMs}ms ===`,
      );
    }
    if (failures.length > 0) {
      console.error(`\n${failures.length} indexer failure(s) across all tenants:`);
      for (const failure of failures) {
        console.error(`  - [${failure.tenant}] ${failure.type}: ${failure.message.split('\n')[0]}`);
      }
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

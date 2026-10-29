#!/usr/bin/env -S npx tsx
/**
 * Co-managed IT review fixtures, composed per layer.
 *
 *   npm run fixtures:co-managed -- --through L9            apply (idempotent)
 *   npm run fixtures:co-managed -- --through L9 --verify   read-only assertions
 *   npm run fixtures:co-managed -- --through L9 --reset    remove layer deltas (dependents first)
 *
 * Each layer module (base.ts, L1a.ts, ...) applies its own delta and declares
 * `requires`. Credentials come from server/.env.local, parsed line by line: do
 * NOT `source` it, DB_PASSWORD_SERVER and REDIS_PASSWORD contain an unquoted '&'.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import { baseModule, FLAG_EXPECTATIONS } from './base';
import { l1aModule } from './L1a';
import { l9Module } from './L9';
import { resolveModules, type FixtureEngines, type FixtureModule } from './shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Layers in order; later cards append theirs here. */
export const REGISTRY: FixtureModule[] = [baseModule, l1aModule, l9Module];

// LEVERAGE: pattern co-managed-env-local — hand-rolled line-by-line reader of
// server/.env.local, as in scripts/dev shell loaders; a shared loader belongs below this.
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export interface Options { through: string; mode: 'apply' | 'verify' | 'reset' }

export function parseArgs(argv: readonly string[]): Options {
  const through = argv.includes('--through') ? argv[argv.indexOf('--through') + 1] : REGISTRY[REGISTRY.length - 1].name;
  if (!through || through.startsWith('--')) throw new Error('--through needs a layer name');
  return { through, mode: argv.includes('--reset') ? 'reset' : argv.includes('--verify') ? 'verify' : 'apply' };
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing or empty in server/.env.local (check the '&' quoting trap)`);
  return value;
}

/** Run the layers for `options`; exported so the composition is testable with a fake db. */
export async function run(db: Knex, options: Options, engines: () => Promise<FixtureEngines>,
  registry: readonly FixtureModule[] = REGISTRY): Promise<boolean> {
  const modules = resolveModules(registry, options.through);
  if (options.mode === 'verify') {
    let ok = true;
    for (const module of modules) {
      for (const report of await module.verify(db)) {
        ok &&= report.ok;
        console.log(`${(report.ok ? 'present' : 'MISMATCH').padEnd(8)} ${module.name.padEnd(6)} ${report.detail}`);
      }
    }
    return ok;
  }
  if (options.mode === 'reset') {
    await db.transaction(async trx => { for (const module of [...modules].reverse()) await module.reset(trx); });
    return true;
  }
  const resolved = await engines();
  await db.transaction(async trx => { for (const module of modules) await module.apply(trx, resolved); });
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = parseEnvFile(readFileSync(path.join(REPO_ROOT, 'server/.env.local'), 'utf8'));
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  const db = knexFactory({
    client: 'pg',
    connection: {
      host: required('DB_HOST'), port: Number(required('DB_PORT')), database: required('DB_NAME_SERVER'),
      user: process.env.DB_USER_ADMIN || 'postgres', password: required('DB_PASSWORD_ADMIN'),
    },
    pool: { min: 0, max: 4 },
  });
  try {
    const ok = await run(db, options, async () => {
      const [{ runOnboardingSeeds }, { verifyPassword }] = await Promise.all([
        import(`${REPO_ROOT}/ee/temporal-workflows/src/db/onboarding-seeds-operations.js`),
        import(`${REPO_ROOT}/shared/utils/encryption.js`),
      ]);
      return { runOnboardingSeeds, verifyPassword, secret: required('NEXTAUTH_SECRET') };
    });
    if (!ok) process.exitCode = 1;
    if (options.mode !== 'verify') console.log(`Co-managed fixtures ${options.mode === 'apply' ? 'applied' : 'removed'} through ${options.through}.`);
    console.log('Release flag (release-v2-0-feature) must be configured per tenant; it is not database state:');
    for (const [tenant, state] of Object.entries(FLAG_EXPECTATIONS)) console.log(`  ${tenant}: ${state}`);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

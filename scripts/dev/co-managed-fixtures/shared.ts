/**
 * Substrate shared by every co-managed fixture layer module.
 *
 * A layer module applies its own delta idempotently and declares the modules it
 * `requires`; the runner (index.ts) composes them in dependency order. Nothing
 * here touches the environment or opens a connection at import time, so layer
 * logic stays testable against a fake knex.
 *
 * Every identifier is a uuidv5 of a fixed namespace plus a stable slug, and
 * every timestamp is a fixed instant, so a second apply rewrites the same bytes.
 */
import { createHash, pbkdf2Sync } from 'node:crypto';
import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

export const FIXTURE_NAMESPACE = '2f6a1d54-9c3b-4d08-8a71-5e0c9b47d213';

/** Stable uuid for a fixture slug. Reruns address the same rows. */
export const id = (slug: string): string => uuidv5(`co-managed-fixtures/${slug}`, FIXTURE_NAMESPACE);
/** Stable lowercase sha-256, for hex-64 fingerprint columns. */
export const fingerprint = (slug: string): string =>
  createHash('sha256').update(`co-managed-fixtures/${slug}`).digest('hex');

/** Fixed clock. Fixture timestamps never drift, so two applies compare equal. */
export const EPOCH = Date.parse('2026-10-26T09:00:00.000Z');
export const at = (offsetHours: number): Date => new Date(EPOCH + offsetHours * 3_600_000);
export const CREATED = at(-24 * 30);
export const VALID_UNTIL = new Date(Date.parse('2099-12-31T00:00:00.000Z'));

/**
 * PBKDF2 salt:hash in the application's stored format, salted from the fixture
 * slug so the row is byte-stable across runs (the shared hashPassword() picks a
 * random salt, which would make every apply differ).
 */
export function deterministicPassword(slug: string, password: string, secret: string): string {
  const salt = createHash('sha256').update(`co-managed-fixtures/password-salt/${slug}`).digest('hex').slice(0, 24);
  const hash = pbkdf2Sync(password, secret + salt, 10_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/** Insert or rewrite a row addressed by its natural key. */
export async function put(trx: Knex.Transaction, table: string, keys: string[], row: Record<string, unknown>): Promise<void> {
  await trx(table).insert(row).onConflict(keys as never).merge();
}

/** Upsert for tables whose natural key has no unique index to conflict on. */
export async function ensure(trx: Knex.Transaction, table: string, where: Record<string, unknown>,
  row: Record<string, unknown>): Promise<void> {
  const found = await trx(table).where(where).first();
  if (found) await trx(table).where(where).update(row);
  else await trx(table).insert({ ...where, ...row });
}

/**
 * The tenant's configured default currency (default_billing_settings), or
 * undefined so the column's own default applies. Never a literal code.
 */
export async function configuredDefaultCurrency(trx: Knex.Transaction, tenant: string): Promise<string | undefined> {
  const row = await trx('default_billing_settings').where({ tenant }).first('default_currency_code');
  return row?.default_currency_code || undefined;
}

export interface SeedLog { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
export const SILENT: SeedLog = { info() {}, warn() {}, error() {} };

/** Product engines a layer may need; injected so layer logic never imports the app at module load. */
export interface FixtureEngines {
  runOnboardingSeeds: (tenantId: string, productCode: string,
    options: { transaction: Knex.Transaction; log: SeedLog }) => Promise<unknown>;
  verifyPassword: (password: string, stored: string) => Promise<boolean>;
  /** NEXTAUTH_SECRET, for the deterministic password hashes. */
  secret: string;
}

export interface VerifyReport {
  ok: boolean;
  area: string;
  detail: string;
}

export interface FixtureModule {
  /** Layer name as typed after `--through`. */
  name: string;
  requires: string[];
  apply(trx: Knex.Transaction, engines: FixtureEngines): Promise<void>;
  /** Read-only assertions; must not write. */
  verify(db: Knex): Promise<VerifyReport[]>;
  /** Remove only what `apply` created (dependents are reset first by the runner). */
  reset(trx: Knex.Transaction): Promise<void>;
}

/** Modules to run for `--through target`, dependencies first, each once. */
export function resolveModules(registry: readonly FixtureModule[], target: string): FixtureModule[] {
  const byName = new Map(registry.map(module => [module.name, module]));
  const order: FixtureModule[] = [];
  const visiting = new Set<string>();
  const visit = (name: string): void => {
    const module = byName.get(name);
    if (!module) throw new Error(`Unknown fixture module '${name}'`);
    if (order.includes(module)) return;
    if (visiting.has(name)) throw new Error(`Fixture module cycle at '${name}'`);
    visiting.add(name);
    for (const required of module.requires) visit(required);
    visiting.delete(name);
    order.push(module);
  };
  visit(target);
  return order;
}

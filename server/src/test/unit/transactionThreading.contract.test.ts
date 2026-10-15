import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

/**
 * A function that accepts the caller's `Knex.Transaction` and then calls
 * `createTenantKnex()` to open its own transaction runs on a *second pool
 * connection*. When the caller already holds a `FOR UPDATE` lock on a row the
 * callee touches, that second connection blocks on the caller's lock while the
 * caller awaits the callee: a self-deadlock, and PostgreSQL's deadlock detector
 * never fires because only one transaction is actually waiting. There is no
 * lock timeout on these paths, so the request hangs forever.
 *
 * That is not hypothetical. `StorageService.deleteFile` did exactly this
 * (fixed in cb65a3444d). Its caller, the comment-attachment draft sweep, runs
 * inside `initializeApp()` during instrumentation `register()` -- so every boot
 * after the 24h draft grace expired wedged all HTTP requests.
 *
 * The walk lives in scripts/check-transaction-threading.mjs so CI and a
 * developer at a terminal (`npm run check:transaction-threading`) run exactly
 * what this asserts. It must run as a real Node process: it loads the
 * TypeScript compiler and parses every candidate file into an AST, which a
 * transformed test environment would not reproduce faithfully.
 */

const REPO_ROOT = resolvePath(__dirname, '../../../..');
const CHECKER = resolvePath(REPO_ROOT, 'scripts/check-transaction-threading.mjs');

interface CheckerResult {
  violations: Array<{ file: string; line: number; name: string; params: string[]; opened: string[] }>;
  scanned: number;
}

function runChecker(extraArgs: string[] = []): { parsed: CheckerResult; failed: boolean } {
  let stdout = '';
  let failed = false;
  try {
    stdout = execFileSync('node', [CHECKER, '--json', ...extraArgs], { cwd: REPO_ROOT, encoding: 'utf-8' });
  } catch (error) {
    failed = true;
    stdout = (error as { stdout?: string }).stdout ?? '';
  }
  return { parsed: JSON.parse(stdout) as CheckerResult, failed };
}

/** A throwaway package so the detector can be aimed at known-good and
 * known-bad source without touching the repo it is guarding. */
function fixture(source: string): string {
  const dir = mkdtempSync(resolvePath(tmpdir(), 'alga-trx-threading-'));
  fixtures.push(dir);
  writeFileSync(resolvePath(dir, 'fixture.ts'), source);
  return dir;
}

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe('transaction threading across db-handle boundaries', () => {
  it('has no function that accepts a caller handle and opens its own connection', () => {
    const { parsed, failed } = runChecker();

    const report = parsed.violations
      .map((v) => `  ${v.file}:${v.line}  ${v.name}(${v.params.join(', ')})\n    opens on: ${v.opened.join(' | ')}`)
      .join('\n');

    expect(
      parsed.violations,
      `function(s) take a caller database handle but open a second connection anyway.\n` +
        `Thread the caller handle (\`const db = transaction ?? knex\`), or add a reasoned entry to\n` +
        `TRANSACTION_THREADING_EXEMPTIONS in scripts/check-transaction-threading.mjs:\n${report}`,
    ).toEqual([]);
    expect(failed).toBe(false);
    // A run that suddenly inspects almost nothing means the file discovery
    // broke, which would make this assertion vacuously green.
    expect(parsed.scanned).toBeGreaterThan(400);
  });

  /**
   * Positive control. Without it, a detector whose AST walk silently stopped
   * matching would report `violations: []` forever and this suite would call
   * that a pass. The fixture is the shape `deleteFile` had before cb65a3444d,
   * including the detail that broke the first attempt at this check: the
   * parameter appears in a *comment*, so anything matching on text rather than
   * on AST identifiers reads it as threaded.
   */
  it('still flags a function that ignores its transaction parameter', () => {
    const dir = fixture(`
import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { withCoManagedOperationalTransaction } from '@alga-psa/licensing';

export async function deleteFixtureFile(fileId: string, transaction?: Knex.Transaction): Promise<void> {
  // The word \`transaction\` appears here and nowhere else in real code.
  const { knex, tenant } = await createTenantKnex();
  await withCoManagedOperationalTransaction(knex, tenant!, async (trx) => {
    await trx('external_files').where({ file_id: fileId }).forUpdate().first();
  });
}
`);

    const { parsed, failed } = runChecker([`--roots=${dir}`]);

    expect(failed).toBe(true);
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0]).toMatchObject({
      name: 'deleteFixtureFile',
      params: ['transaction'],
      opened: ['knex'],
    });
  });

  /**
   * Negative control: the fix shape must actually clear the detector, so the
   * check stays actionable rather than becoming a wall of noise that gets
   * blanket-exempted.
   */
  it('accepts the threaded shape and the `trx ? work(trx) : withTransaction(knex, work)` shape', () => {
    const dir = fixture(`
import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withCoManagedOperationalTransaction } from '@alga-psa/licensing';

export async function deleteFixtureFile(fileId: string, transaction?: Knex.Transaction): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const db = transaction ?? knex;
  await withCoManagedOperationalTransaction(db, tenant!, async (trx) => {
    await trx('external_files').where({ file_id: fileId }).forUpdate().first();
  });
}

export async function cleanupFixtureTokens(trx?: Knex.Transaction): Promise<number> {
  const { knex } = await createTenantKnex();
  const cleanup = async (tx: Knex.Transaction) => tx('tokens').where('expires_at', '<', tx.fn.now()).del();
  return trx ? cleanup(trx) : withTransaction(knex, cleanup);
}
`);

    const { parsed, failed } = runChecker([`--roots=${dir}`]);

    expect(parsed.violations).toEqual([]);
    expect(failed).toBe(false);
    expect(parsed.scanned).toBe(1);
  });
});

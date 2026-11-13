import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOTS = ['packages', 'shared', 'server/src', 'ee/server/src', 'ee/packages', 'services'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '__tests__', 'test', 'tests']);
const WRITE = /\.(insert|update|delete|del)\(/;
// A query on the table reaches its write call within this many lines.
const WRITE_WINDOW = 15;

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function writesRecurringServicePeriods(source: string): boolean {
  const lines = source.split('\n');
  return lines.some((line, index) =>
    /['"`]recurring_service_periods['"`]/.test(line)
    && lines.slice(index, index + WRITE_WINDOW).some((candidate) => WRITE.test(candidate)));
}

describe('recurring_service_periods writers', () => {
  // The table is Citus-distributed and so carries no billing_semantics_mutation
  // trigger: a writer that does not take the lock itself can change periods
  // under an invoice run that already read them.
  it('take the tenant billing lock', () => {
    const writers = SOURCE_ROOTS
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .filter((file) => writesRecurringServicePeriods(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));

    expect(writers.length).toBeGreaterThanOrEqual(7);
    const unlocked = writers.filter(
      (file) => !fs.readFileSync(path.join(repoRoot, file), 'utf8').includes('lockTenantBilling('),
    );
    expect(unlocked).toEqual([]);
  });
});

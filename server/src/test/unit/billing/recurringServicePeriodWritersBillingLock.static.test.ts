import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOTS = ['packages', 'shared', 'server/src', 'ee/server/src', 'ee/packages', 'services'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '__tests__', 'test', 'tests']);
const WRITE = /\.(insert|update|delete|del)\(/;
const INVOICE_SERVICE = 'packages/billing/src/services/invoiceService.ts';
const INVOICE_GENERATION = 'packages/billing/src/actions/invoiceGeneration.ts';
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
      (file) => file !== INVOICE_SERVICE
        && !fs.readFileSync(path.join(repoRoot, file), 'utf8').includes('lockTenantBilling('),
    );
    expect(unlocked).toEqual([]);
  });

  // invoiceService claims periods without locking: taking the lock again would
  // add statements to every invoice run for nothing. That holds only while its
  // two claim functions are reached solely through the locked generation path.
  it('reach the invoice period claims only from locked invoice generation', () => {
    const callers = SOURCE_ROOTS
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .filter((file) => path.relative(repoRoot, file) !== INVOICE_SERVICE)
      .filter((file) => /\b(persistInvoiceCharges|claimRecurringServicePeriodsForSelectionInputs)\(/
        .test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));
    expect(callers).toEqual([INVOICE_GENERATION]);

    const generation = fs.readFileSync(path.join(repoRoot, INVOICE_GENERATION), 'utf8');
    const section = (from: string, to: string) => generation.split(from)[1].split(to)[0];

    // The transaction takes the lock before anything else runs in it.
    const entry = section(
      'export async function generateInvoiceForNormalizedSelectionInputs(',
      'async function generateInvoiceForLockedSelectionInputs(',
    );
    expect(entry.indexOf('await lockTenantBilling(trx, params.tenant);')).toBeGreaterThan(-1);
    expect(entry.indexOf('await lockTenantBilling(trx, params.tenant);'))
      .toBeLessThan(entry.indexOf('generateInvoiceForLockedSelectionInputs('));

    // Recurring invoices are created only inside that transaction...
    const locked = section(
      'async function generateInvoiceForLockedSelectionInputs(',
      'export const generateInvoiceForSelectionInputs',
    );
    expect(generation.match(/createInvoiceFromBillingResultImpl\(/g)).toHaveLength(3);
    expect(locked.match(/createInvoiceFromBillingResultImpl\(/g)).toHaveLength(2);
    expect(generation.match(/generateInvoiceForLockedSelectionInputs\(/g)).toHaveLength(2);

    // ...and the session-bound wrapper only ever creates project invoices,
    // which claim no recurring period.
    const wrapperCalls = generation.split('await createInvoiceFromBillingResult(').slice(1);
    expect(wrapperCalls).toHaveLength(2);
    for (const call of wrapperCalls) expect(call.split(');')[0]).toContain('{ projectId }');
  });
});

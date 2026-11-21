/**
 * F068 coverage guard: operational (seat-technician) time entries never reach a commercial read.
 *
 * Every non-test source file under the commercial roots that reads `time_entries` must either use the shared
 * predicate (`commercialTimeEntrySql` from @alga-psa/types, or the scheduling approval helpers built on it), or
 * be listed in EXEMPT with the reason it is not a commercial read. A new file that reads `time_entries` for
 * billing, unbilled lists or approval without the predicate fails here until it adopts it or is classified.
 *
 * Mirrors packages/scheduling/src/test/timeSourceCoverage.static.test.ts (the seam coverage). The row-level
 * behaviour is asserted against a real database in server/src/test/integration/coManagedOperationalTimeStaysOut.integration.test.ts (T036).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const PREDICATE = /commercialTimeEntrySql|commercialTimeEntriesOnly|commercialEntriesOnly|excludeOperationalOnlyTimeSheets/;
// `time_entries` as a relation, not `invoice_time_entries` and friends.
const READS_TIME_ENTRIES = /(?<![A-Za-z_])time_entries(?![A-Za-z_])/;

/** Directories scanned recursively (non-test sources only). */
const COMMERCIAL_ROOTS = ['packages/billing/src', 'shared/billingClients'];

/** Approval modules named one by one: they must keep the predicate. */
const APPROVAL_MODULES = [
  'packages/scheduling/src/actions/timeSheetActions.ts',
  'packages/scheduling/src/actions/timeEntryCrudActions.ts',
  'server/src/lib/api/services/timeSheetStatus.ts',
  'server/src/lib/api/services/TimeSheetService.ts',
];

/** Files under the roots that read `time_entries` WITHOUT being a commercial read, and why. */
const EXEMPT: Record<string, string> = {
  'packages/billing/src/actions/contractReportActions.ts': 'comment only: usage reports read the ledger, never raw time_entries',
  'packages/billing/src/actions/contractWizardActions.ts': 'clears contract_line_id on a line being removed; not a read of billable time',
  'packages/billing/src/models/contract.ts': 'clears contract_line_id before deleting a line; not a read of billable time',
  'packages/billing/src/actions/hourBlockActions.ts': 'display of already-recorded block allocations (rows exist only for commercial draws)',
  'packages/billing/src/actions/invoiceModification.ts': 'writes by entry id for entries already on the invoice being edited',
  'packages/billing/src/actions/invoiceQueries.ts': 'reads time already invoiced (invoice_time_entries join)',
  'packages/billing/src/lib/adapters/invoiceAdapters.server.ts': 'reads time already invoiced (invoice_time_entries join)',
  'packages/billing/src/models/invoice.ts': 'snapshots time already invoiced',
  'packages/billing/src/services/invoiceService.ts': 'marks the entries a finished charge list names as invoiced; the list is built from the guarded engine reads',
  'packages/billing/src/actions/serviceActions.ts': 'existence check before deleting a service (any entry blocks it, operational or not)',
  'packages/billing/src/lib/billing/timeEntryWorkContext.ts': 'work-context join contract; no entry filtering',
  'packages/billing/src/actions/projectBillingConfigActions.ts': 'project labour cost report, not billing or unbilled time (reviewer: confirm client IT effort should not count as MSP cost)',
  'packages/billing/src/actions/profitabilityReportActions.ts': 'profitability report over invoiced and recorded time, not a billing run, preview, unbilled list or approval queue',
  'packages/billing/src/models/userCostRate.ts': 'cost-rate change check over a date window; not a billing read',
  'shared/billingClients/contractBillingTrace.ts': 'trace of a line\'s already-attributed entries',
  'shared/billingClients/ticketProjectAttribution.ts': 'SQL join helper; takes the caller\'s alias',
};

const isTest = (name: string) => /\.test\.|\.spec\./.test(name) || name === '__tests__' || name === 'tests' || name === 'node_modules' || name === 'dist';
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    isTest(e.name) ? [] : e.isDirectory() ? sources(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path.join(dir, e.name)] : []);
const rel = (f: string) => path.relative(repo, f).split(path.sep).join('/');

/** Files in `files` (rel path -> source) that read time_entries without the predicate and are not exempt. */
const uncovered = (files: Record<string, string>, exempt = EXEMPT) =>
  Object.entries(files).filter(([f, src]) => READS_TIME_ENTRIES.test(src) && !PREDICATE.test(src) && !(f in exempt)).map(([f]) => f);

describe('commercial time-entry reads exclude operational entries (F068)', () => {
  const files = Object.fromEntries(COMMERCIAL_ROOTS.flatMap((r) => sources(path.join(repo, r))).map((f) => [rel(f), read(f)]));

  it('every commercial read of time_entries uses the shared predicate or is classified', () => {
    expect(uncovered(files)).toEqual([]);
  });

  it('every exemption still exists and still reads time_entries (no stale classification)', () => {
    for (const f of Object.keys(EXEMPT)) {
      expect(files[f], `${f} no longer exists`).toBeDefined();
      expect(READS_TIME_ENTRIES.test(files[f]), `${f} no longer reads time_entries; drop the exemption`).toBe(true);
      expect(PREDICATE.test(files[f]), `${f} now uses the predicate; drop the exemption`).toBe(false);
    }
  });

  it.each(APPROVAL_MODULES)('%s keeps the predicate on approval reads and writes', (m) => {
    expect(read(path.join(repo, m))).toMatch(PREDICATE);
  });

  it('the billing engine applies it to every time_entries collection it builds', () => {
    const engine = read(path.join(repo, 'packages/billing/src/lib/billing/billingEngine.ts'));
    const collections = (engine.match(/db\.table(?:<any>)?\(\s*["']time_entries["']\)|FROM time_entries te|"time_entries as te"/g) ?? []).length;
    const guarded = (engine.match(/commercialTimeEntrySql\(/g) ?? []).length;
    expect(collections).toBeGreaterThan(0);
    expect(guarded).toBeGreaterThanOrEqual(collections);
  });

  it('the check catches a new unguarded read, and accepts a guarded or classified one', () => {
    const bare = "const q = db.table('time_entries').where('invoiced', false);";
    expect(uncovered({ 'packages/billing/src/actions/newUnbilledList.ts': bare })).toEqual(['packages/billing/src/actions/newUnbilledList.ts']);
    expect(uncovered({ 'packages/billing/src/actions/newUnbilledList.ts': `${bare} q.whereRaw(commercialTimeEntrySql('time_entries'));` })).toEqual([]);
    expect(uncovered({ 'packages/billing/src/actions/newUnbilledList.ts': bare }, { 'packages/billing/src/actions/newUnbilledList.ts': 'reason' })).toEqual([]);
    expect(uncovered({ 'packages/billing/src/actions/invoiceOnly.ts': "db.table('invoice_time_entries')" })).toEqual([]);
  });
});

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUNDLE_RULE_RESOURCE_TYPE_CATALOG } from '@alga-psa/authorization/bundles/catalog';
import { TENANT_TABLE_MANIFEST } from '@alga-psa/db';

import {
  AUTHORIZATION_ENTRY_POINTS,
  COMMERCIAL_TABLES,
  COVERED_RESOURCE_TYPES,
  COVERED_TABLES,
  OPAQUE_FILES,
  analyzeRepository,
  checkPinned,
  describeProblems,
  isOpaqueFile,
  readCoverageViolations,
} from './support/coverageDefinitions';
import { READ_COVERAGE_PINNED } from './support/readCoveragePinned';

/**
 * S20 (F036): read-authorization coverage.
 *
 * Every exported server action ('use server' module), controller method (server/src/lib/api/controllers) and
 * route handler (app/api/**\/route.ts, unless it only delegates to a controller method) that reads a table
 * whose client-ownership declaration maps to a covered kernel resource must reach an authorization entry
 * point (`AUTHORIZATION_ENTRY_POINTS`), directly or through followed helpers, methods and imports.
 *
 * Today's exceptions are pinned one by one in `support/readCoveragePinned.ts`. The list may shrink and may
 * not grow: a violation that is not pinned fails, and a pinned entry that stopped being a violation fails
 * with an instruction to delete it. The analysis lives in `support/sourceAnalysis.ts`; the definitions of
 * "covered" and "entry point" live in `support/coverageDefinitions.ts`.
 *
 * KNOWN BLIND SPOTS (heuristic gaps; none of these is a silent pass, they are where the analysis can
 * be wrong in either direction):
 *   - Table names that are computed at run time are not attributed to a table (`dynamicTables`).
 *   - Raw SQL is read only where the SQL text is a literal passed to raw/whereRaw/joinRaw/selectRaw/fromRaw/query.
 *   - A method call on a receiver whose class cannot be determined (an `any`/interface-typed injected service, a
 *     factory's return value) is not followed, so a read behind it is invisible and so is a gate behind it.
 *   - A query builder stored in a variable and written to later is counted as a read.
 *   - Callee names are matched across the whole reachable closure, so a gate on one branch counts for all,
 *     and a call by name cannot prove the gate's result filters this particular query.
 *   - Authentication/authorization infrastructure (packages/auth, authorization, db, API middleware) is not
 *     entered: its own reads are not the caller's, and its entry points are matched by name at the call.
 */

describe('read-authorization coverage (S20, F036)', () => {
  it('derives the covered tables from the ownership declarations and the kernel catalog', () => {
    expect([...COVERED_TABLES.keys()]).toEqual(expect.arrayContaining(['tickets', 'projects', 'project_tasks', 'assets', 'documents', 'clients', 'contacts', 'interactions', 'time_entries', 'schedule_entries', 'tag_mappings', 'comments']));
    for (const [table, resource] of COVERED_TABLES) {
      expect(COVERED_RESOURCE_TYPES.has(resource), `${table} -> ${resource}`).toBe(true);
      expect(BUNDLE_RULE_RESOURCE_TYPE_CATALOG.has(resource), `${resource} is not in the kernel catalog`).toBe(true);
    }
    // Carrying a client_id is not enough: these declare ownership but are not one of the plan's resources.
    for (const table of ['rma_cases', 'sales_orders', 'quotes', 'invoices', 'contracts']) expect(COVERED_TABLES.has(table), table).toBe(false);
  });

  it('keeps the commercial tables and the entry points well-formed', () => {
    const manifest = new Set(TENANT_TABLE_MANIFEST.map((entry) => entry.table));
    expect([...COMMERCIAL_TABLES].filter((table) => !manifest.has(table)), 'commercial tables exist in the manifest').toEqual([]);
    expect(AUTHORIZATION_ENTRY_POINTS.size).toBeGreaterThan(30);
    for (const name of AUTHORIZATION_ENTRY_POINTS) expect(name).toMatch(/^[A-Za-z]+$/);
  });

  it('treats recipient-authorization modules as opaque, never as a gate', () => {
    const root = path.resolve(__dirname, '../../../../..');
    for (const file of OPAQUE_FILES) {
      expect(fs.existsSync(path.join(root, file)), `${file} exists`).toBe(true);
      expect(isOpaqueFile(path.join(root, file)), file).toBe(true);
      // Opacity hides the module's own reads; it must never stand in for an authorization entry point.
      for (const name of AUTHORIZATION_ENTRY_POINTS) {
        expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(new RegExp(`export (?:async )?function ${name}\\b`));
      }
    }
    // Only the named recipient boundary: comment audience reads stay visible to the analysis.
    expect(isOpaqueFile(path.join(root, 'shared/lib/commentAudience.ts'))).toBe(false);
    expect(isOpaqueFile(path.join(root, 'shared/lib/notificationAudienceExtras.ts'))).toBe(false);
  });

  it('has a sorted, duplicate-free pinned list with a reason on every entry', () => {
    const ids = READ_COVERAGE_PINNED.map((p) => `${p.file}\u0000${p.export}`);
    expect(ids, 'READ_COVERAGE_PINNED must be sorted by file, then export').toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(READ_COVERAGE_PINNED.filter((p) => !p.reason.trim()).map((p) => `${p.file}#${p.export}`)).toEqual([]);
  });

  it('every read of a covered table reaches an authorization entry point, or is pinned', () => {
    const { analyzed } = analyzeRepository();
    const problems = checkPinned(readCoverageViolations(analyzed), READ_COVERAGE_PINNED);
    const lines = describeProblems('read coverage', problems, 'call an authorization entry point (see AUTHORIZATION_ENTRY_POINTS) before returning covered rows');
    expect(lines, lines.join('\n')).toEqual([]);
  }, 180_000);
});

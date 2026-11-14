import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_TABLES,
  analyzeRepository,
  checkPinned,
  commercialReadProblems,
  describeCommercialProblems,
  describeProblems,
  isPermissionCheck,
  permissionCoverageViolations,
} from './support/coverageDefinitions';
import { KNOWN_COMMERCIAL_READS } from './support/knownCommercialReads';
import { PERMISSION_COVERAGE_PINNED } from './support/permissionCoveragePinned';

/**
 * S20 (F037): permission coverage.
 *
 * Every exported server action ('use server' module) that touches a tenant table must reach a permission
 * check (`isPermissionCheck`: a has/check/require/assert/ensure/can ... Permission call, a named gate, or an
 * authorization entry point) directly or through followed helpers. `withAuth` authenticates and is not a
 * check. Today's actions without one are pinned one by one in `support/permissionCoveragePinned.ts`. The
 * list may shrink and may not grow; a pinned entry that now has a check fails until it is deleted.
 *
 * No pinned action may read a commercial table (`COMMERCIAL_TABLES`: pricing and contract data), except the
 * entries in `support/knownCommercialReads.ts`. That list exists because the PRD assumed two such actions
 * (`getServices`, `getEligibleContractLinesForUI`) and the contract found more; all are to be fixed by the
 * companion plan. It is shrink-only too, and a pinned commercial read that is not in it fails.
 *
 * KNOWN BLIND SPOTS (heuristic gaps, in both directions):
 *   - Table names computed at run time are not attributed to a table, so such an action may look
 *     like it touches no tenant data and escape the contract.
 *   - Raw SQL is read only where the SQL text is a literal passed to raw/whereRaw/joinRaw/selectRaw/fromRaw/query.
 *   - A method call on a receiver whose class cannot be determined (an `any`/interface-typed injected
 *     service, a factory's return value) is not followed: data touched behind it is invisible, and so is a
 *     permission check behind it, which can make an action look unchecked when it is not.
 *   - A check anywhere in the reachable closure counts, even on one branch, and a check by name cannot
 *     prove it guards this particular access.
 *   - Only exported functions of 'use server' modules are server actions; route handlers and controller
 *     methods are covered by the read contract, not this one.
 *   - Authentication/authorization infrastructure is not entered; its own table reads do not count as the
 *     action touching tenant data.
 */

describe('permission coverage (S20, F037)', () => {
  it('recognises permission checks by name and does not treat authentication as one', () => {
    for (const name of ['hasPermission', 'checkPermission', 'requirePermission', 'assertMspPermission', 'hasApiContextPermission', 'assertProjectReadAllowed', 'authorizeResource']) expect(isPermissionCheck(name), name).toBe(true);
    for (const name of ['withAuth', 'withOptionalAuth', 'getCurrentUser', 'updatePermissions', 'isActionPermissionError', 'throwPermissionError', 'getClientIdFromPortalUser']) expect(isPermissionCheck(name), name).toBe(false);
  });

  it('has sorted, duplicate-free pinned lists with a reason on every entry', () => {
    for (const [name, list] of [['PERMISSION_COVERAGE_PINNED', PERMISSION_COVERAGE_PINNED], ['KNOWN_COMMERCIAL_READS', KNOWN_COMMERCIAL_READS]] as const) {
      const ids = list.map((p) => `${p.file}\u0000${p.export}`);
      expect(ids, `${name} must be sorted by file, then export`).toEqual([...ids].sort());
      expect(new Set(ids).size, `${name} has duplicates`).toBe(ids.length);
      expect(list.filter((p) => !p.reason.trim()).map((p) => `${p.file}#${p.export}`), `${name} reasons`).toEqual([]);
    }
  });

  it('every action that touches tenant data reaches a permission check, or is pinned', () => {
    const { analyzed } = analyzeRepository();
    const problems = checkPinned(permissionCoverageViolations(analyzed), PERMISSION_COVERAGE_PINNED);
    const lines = describeProblems('permission coverage', problems, 'add a permission check (hasPermission / checkPermission / ...) to the action');
    expect(lines, lines.join('\n')).toEqual([]);
  }, 180_000);

  it('no pinned action reads a commercial table, other than the known list', () => {
    expect(COMMERCIAL_TABLES.size).toBeGreaterThan(40);
    const { analyzed } = analyzeRepository();
    const lines = describeCommercialProblems(commercialReadProblems(analyzed, PERMISSION_COVERAGE_PINNED, KNOWN_COMMERCIAL_READS));
    expect(lines, lines.join('\n')).toEqual([]);
  }, 180_000);
});

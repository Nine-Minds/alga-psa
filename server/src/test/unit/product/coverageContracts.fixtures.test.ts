import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Program,
  analyzeFiles,
  checkPinned,
  commercialReadProblems,
  describeCommercialProblems,
  describeProblems,
  entryId,
  permissionCoverageViolations,
  readCoverageViolations,
  type PinnedEntry,
} from './support/coverageDefinitions';
import { repositoryRoot } from './support/sourceAnalysis';

/**
 * S20 (T021): the coverage analyses run on small synthetic sources. The sources are in-memory, at paths that
 * do not exist on disk, so the real source walk of the contracts can never pick them up.
 */

const root = path.join(repositoryRoot, '__s20_fixtures__');
const at = (name: string) => path.join(root, name);

function analyze(files: Record<string, string>) {
  const virtual = Object.fromEntries(Object.entries(files).map(([name, text]) => [at(name), text]));
  return analyzeFiles(new Program(virtual), Object.keys(virtual).filter((name) => !name.endsWith('helper.ts'))).analyzed;
}
const pin = (name: string, exported: string, reason = 'fixture'): PinnedEntry => ({ file: path.relative(repositoryRoot, at(name)).split(path.sep).join('/'), export: exported, reason });

const unauthorizedRead = `'use server';
export async function listTickets() {
  const trx = await getTrx();
  return trx('tickets').select('*');
}`;
const authorizedRead = `'use server';
export async function listTickets() {
  const trx = await getTrx();
  const scope = await createTicketReadScope(trx, user);
  return trx('tickets').select('*');
}`;

describe('coverage contracts on fixtures (S20, T021)', () => {
  it('1. flags an action that reads a covered table without reaching an authorization entry point', () => {
    const violations = readCoverageViolations(analyze({ 'a.ts': unauthorizedRead }));
    expect(violations.map((v) => v.entry.export)).toEqual(['listTickets']);
    const problems = checkPinned(violations, []);
    expect(describeProblems('read coverage', problems, 'fix it').join('\n')).toMatch(/not in the pinned list[\s\S]*listTickets/);
  });

  it('2. passes the same action once it calls an entry point, directly or through a followed helper or alias', () => {
    expect(readCoverageViolations(analyze({ 'a.ts': authorizedRead }))).toEqual([]);
    expect(readCoverageViolations(analyze({
      'a.ts': `'use server';\nimport { scoped } from './helper';\nexport async function listTickets() { return scoped(await getTrx()); }`,
      'helper.ts': `export async function scoped(trx) { await createTicketReadScope(trx, u); return trx('tickets').select('*'); }`,
    }))).toEqual([]);
    expect(readCoverageViolations(analyze({
      'a.ts': `'use server';\nimport { scoped } from './helper';\nexport async function listTickets() { return scoped(await getTrx()); }`,
      'helper.ts': `export async function scoped(trx) { return trx('tickets').select('*'); }`,
    })).map((v) => v.entry.export)).toEqual(['listTickets']);
    expect(readCoverageViolations(analyze({
      'a.ts': `'use server';\nimport { getClientIdFromPortalUser as own } from '@alga-psa/billing/lib/clientPortalAccess';\nexport async function listTickets() { const trx = await getTrx(); await own(trx, u, t); return trx('tickets').select('*'); }`,
    }))).toEqual([]);
  });

  it('does not flag reads of uncovered tables, pure inserts, or non-exported helpers', () => {
    expect(readCoverageViolations(analyze({ 'a.ts': `'use server';\nexport async function f() { const trx = await getTrx(); return trx('quotes').select('*'); }` }))).toEqual([]);
    expect(readCoverageViolations(analyze({ 'a.ts': `'use server';\nexport async function f() { const trx = await getTrx(); return trx('tickets').insert({}); }` }))).toEqual([]);
    expect(readCoverageViolations(analyze({ 'a.ts': `'use server';\nasync function f() { const trx = await getTrx(); return trx('tickets').select('*'); }` }))).toEqual([]);
    expect(readCoverageViolations(analyze({ 'a.ts': `export async function f() { const trx = await getTrx(); return trx('tickets').select('*'); }` }))).toEqual([]);
  });

  it('3. flags an action with no permission check unless it is pinned; withAuth alone is not a check', () => {
    const source = `'use server';\nexport const listNotes = withAuth(async (user) => { const trx = await getTrx(); return trx('comments').select('*'); });`;
    const violations = permissionCoverageViolations(analyze({ 'a.ts': source }));
    expect(violations.map((v) => v.entry.export)).toEqual(['listNotes']);
    expect(checkPinned(violations, []).unpinned).toEqual([entryId(violations[0].entry)]);
    const pinned = checkPinned(violations, [pin('a.ts', 'listNotes')]);
    expect(pinned).toMatchObject({ unpinned: [], stale: [], emptyReasons: [], duplicates: [] });
    const checked = `'use server';\nexport const listNotes = withAuth(async (user) => { const trx = await getTrx(); if (!await hasPermission(user, 'ticket', 'read', trx)) throw new Error('no'); return trx('comments').select('*'); });`;
    expect(permissionCoverageViolations(analyze({ 'a.ts': checked }))).toEqual([]);
    expect(permissionCoverageViolations(analyze({ 'a.ts': `'use server';\nexport async function noData() { return 1; }` }))).toEqual([]);
  });

  it('4. fails a pinned action that reads a commercial table, unless the known list names it', () => {
    const analyzed = analyze({ 'a.ts': `'use server';\nexport async function getPrices() { const trx = await getTrx(); return trx('service_prices').select('*'); }` });
    const pinned = [pin('a.ts', 'getPrices')];
    expect(checkPinned(permissionCoverageViolations(analyzed), pinned).unpinned).toEqual([]);
    const failing = commercialReadProblems(analyzed, pinned, []);
    expect(Object.values(failing.unknown)).toEqual([['service_prices']]);
    expect(describeCommercialProblems(failing).join('\n')).toMatch(/service_prices/);
    expect(describeCommercialProblems(commercialReadProblems(analyzed, pinned, [pin('a.ts', 'getPrices', 'companion plan')]))).toEqual([]);
    // A known entry that stopped reading a commercial table (or is no longer pinned) is stale.
    expect(commercialReadProblems(analyzed, [], [pin('a.ts', 'getPrices')]).stale).toEqual([pin('a.ts', 'getPrices').file + '#getPrices']);
  });

  it('5. reports a stale pinned entry with an instruction to delete it', () => {
    const analyzed = analyze({ 'a.ts': authorizedRead });
    const problems = checkPinned(readCoverageViolations(analyzed), [pin('a.ts', 'listTickets')]);
    expect(problems.stale).toEqual([pin('a.ts', 'listTickets').file + '#listTickets']);
    expect(describeProblems('read coverage', problems, 'fix it').join('\n')).toMatch(/no longer a violation\. Delete it from the list[\s\S]*listTickets/);
    expect(checkPinned([], [pin('a.ts', 'gone', '  ')]).emptyReasons).toHaveLength(1);
    expect(checkPinned([], [pin('a.ts', 'x'), pin('a.ts', 'x')]).duplicates).toHaveLength(1);
  });
});

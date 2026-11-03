/**
 * (1) Behavioural contract of the shared after-commit double
 *     (packages/db/test-utils/afterCommitDouble.ts) vs packages/db/src/lib/afterCommit.ts.
 * (2) Mock-surface check: every full-replacement vi.mock('@alga-psa/db') in the
 *     CM T0-9b test files must export every name the action modules import
 *     from '@alga-psa/db'. A missing export otherwise silently answers
 *     `undefined` (the shard-4 failure: registerAfterCommit).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createAfterCommitDouble,
  assertMockCovers,
} from '../../../../packages/db/test-utils/afterCommitDouble';

describe('after-commit double', () => {
  const makeTrx = () => ({ id: Symbol('trx') });

  it('defers hooks until the callback resolves, in order', async () => {
    const ac = createAfterCommitDouble(makeTrx);
    const order: string[] = [];
    await ac.withTransaction({}, async (trx) => {
      ac.registerAfterCommit(trx, () => { order.push('a'); }, 'a');
      ac.registerAfterCommit(trx, () => { order.push('b'); }, 'b');
      expect(order).toEqual([]);
      expect(ac.pending(trx)).toBe(2);
      order.push('body');
    });
    expect(order).toEqual(['body', 'a', 'b']);
    expect(ac.flushed).toEqual(['a', 'b']);
  });

  it('drops hooks on rollback and rethrows', async () => {
    const ac = createAfterCommitDouble(makeTrx);
    let ran = false;
    await expect(
      ac.withTransaction({}, async (trx) => {
        ac.registerAfterCommit(trx, () => { ran = true; }, 'x');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(ran).toBe(false);
    expect(ac.flushed).toEqual([]);
    expect(ac.dropped).toEqual(['x']);
  });

  it('swallows hook errors and still runs remaining hooks', async () => {
    const ac = createAfterCommitDouble(makeTrx);
    let second = false;
    await ac.withTransaction({}, async (trx) => {
      ac.registerAfterCommit(trx, () => { throw new Error('hook'); });
      ac.registerAfterCommit(trx, () => { second = true; });
    });
    expect(second).toBe(true);
  });

  it('nested frames share the outer trx and flush once, at the outermost commit', async () => {
    const ac = createAfterCommitDouble(makeTrx);
    let ran = 0;
    await ac.withTransaction({}, async (outer) => {
      await ac.withTransaction(outer, async (inner) => {
        expect(inner).toBe(outer);
        ac.registerAfterCommit(inner, () => { ran++; });
      });
      expect(ran).toBe(0);
    });
    expect(ran).toBe(1);
  });
});

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Named imports from '@alga-psa/db' in a module (value imports only). */
function dbImports(rel: string): string[] {
  const m = read(rel).match(/import\s*\{([^}]*)\}\s*from\s*'@alga-psa\/db'/);
  if (!m) return [];
  return m[1].split(',').map((n) => n.trim()).filter((n) => n && !n.startsWith('type ')).map((n) => n.split(/\s+as\s+/)[0]);
}

/** Top-level names of an object literal returned/ written by the db vi.mock factory. */
function mockedNames(rel: string): string[] {
  const src = read(rel);
  const start = src.search(/vi\.mock\(\s*'@alga-psa\/db'/);
  expect(start, `${rel} has no @alga-psa/db mock`).toBeGreaterThanOrEqual(0);
  // Slice up to the next top-level vi.mock / import after the db mock.
  const rest = src.slice(start + 10);
  const end = rest.search(/\n(vi\.mock\(|import )/);
  const body = rest.slice(0, end === -1 ? undefined : end);
  const names = new Set<string>();
  let depth = 0;
  for (const line of body.split('\n')) {
    const mm = /^\s*([A-Za-z_$][\w$]*)\s*(:|,|\()/.exec(line);
    // depth 2 = inside `() => ({` ... or `() => { return {`
    if (mm && depth >= 1 && depth <= 2 && !['return', 'const', 'let', 'if', 'for'].includes(mm[1])) {
      const indent = /^\s*/.exec(line)![0].length;
      if (indent <= 4) names.add(mm[1]);
    }
    for (const ch of line) { if (ch === '{' || ch === '(') depth++; else if (ch === '}' || ch === ')') depth--; }
  }
  return [...names];
}

const MODULES = [
  'packages/projects/src/actions/projectActions.ts',
  'packages/projects/src/actions/projectTaskActions.ts',
  'packages/projects/src/actions/projectTaskStatusActions.ts',
];

// Full-replacement db mocks whose code under test reaches the modules above.
const MOCK_FILES = [
  'server/src/test/unit/projectPermissions.test.ts',
  'server/src/test/unit/projectTemplateActions.test.ts',
  'packages/projects/src/actions/duplicateTaskTicketLinkBilling.test.ts',
];

describe('@alga-psa/db mock surface ⊇ imports (T0-9b modules)', () => {
  const needed = [...new Set(MODULES.flatMap(dbImports))];

  it('discovers the imports it checks', () => {
    expect(needed).toEqual(expect.arrayContaining(['registerAfterCommit', 'withTransaction', 'tenantDb', 'createTenantKnex']));
  });

  for (const file of MOCK_FILES) {
    it(`${file} exports every imported name`, () => {
      const exported = Object.fromEntries(mockedNames(file).map((n) => [n, true]));
      assertMockCovers(exported, needed, `${file} @alga-psa/db mock`);
    });
  }

  it('assertMockCovers names the missing export', () => {
    expect(() => assertMockCovers({ a: 1 }, ['a', 'registerAfterCommit'])).toThrow(/registerAfterCommit/);
  });
});

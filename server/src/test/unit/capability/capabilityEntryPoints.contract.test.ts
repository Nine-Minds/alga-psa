import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * AST gate-coverage contract (plan 2.7).
 *
 * Rules, applied to entry-point globs (never to a hand-maintained file list):
 *  A. No entry point may read `release-v2-0-feature` directly (the only
 *     sanctioned consumers are the allowlist below). Co-managed code must go
 *     through the capability gate / useCapability.
 *  B. `release-v1-6-feature` must not be referenced anywhere in source.
 *  C. `serves`, `servesBatch`, `filterServed` never reference the flag evaluator.
 */

const REPO = resolve(__dirname, '../../../../..');
const V2 = 'release-v2-0-feature';
const V1_6 = 'release-v1-6-feature';

// Sanctioned references to the v2 flag key, each with the reason it is allowed.
const ALLOW_V2: Record<string, string> = {
  'packages/projects/src/components/ProjectDetail.tsx': 'Timeline view consumer (feature-flags.md section 14)',
  'packages/core/src/lib/capability.ts': 'co-managed gate definition',
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'out']);
const isTest = (p: string) => /\.(test|spec)\.[tj]sx?$|\/__tests__\/|\/test\//.test(p);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

const ROOTS = ['server/src', 'packages', 'shared', 'services', 'ee/server/src', 'ee/temporal-workflows/src'];

function stringLiterals(source: string, file = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Rule A: direct v2 flag key literals in non-allowlisted production source. */
export function ruleAViolations(source: string): string[] {
  return stringLiterals(source).filter((s) => s === V2);
}
/** Rule B: any v1.6 flag reference. */
export function ruleBViolations(source: string): string[] {
  return stringLiterals(source).filter((s) => s === V1_6);
}

/** Rule C: identifiers referenced inside the named function bodies. */
export function identifiersInFunctions(source: string, names: string[]): Record<string, string[]> {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const found: Record<string, string[]> = {};
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text) && n.body) {
      const ids: string[] = [];
      const inner = (c: ts.Node) => {
        if (ts.isIdentifier(c)) ids.push(c.text);
        ts.forEachChild(c, inner);
      };
      inner(n.body);
      found[n.name.text] = ids;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('capability gate coverage (AST)', () => {
  const files = ROOTS.flatMap((r) => {
    try {
      return walk(join(REPO, r));
    } catch {
      return [];
    }
  })
    .map((f) => relative(REPO, f))
    .filter((f) => !isTest(`/${f}`));

  it('scans a plausible number of production entry points', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('Rule A: only allowlisted files reference release-v2-0-feature', () => {
    const offenders = files.filter(
      (f) => !(f in ALLOW_V2) && ruleAViolations(readFileSync(join(REPO, f), 'utf8')).length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it('Rule A allowlist has no stale entries', () => {
    for (const f of Object.keys(ALLOW_V2)) {
      expect(ruleAViolations(readFileSync(join(REPO, f), 'utf8')).length, f).toBeGreaterThan(0);
    }
  });

  it('Rule B: release-v1-6-feature is referenced nowhere', () => {
    const offenders = files.filter((f) => ruleBViolations(readFileSync(join(REPO, f), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });

  it('Rule C: serves / servesBatch / filterServed never reference the flag evaluator', () => {
    const src = readFileSync(join(REPO, 'packages/core/src/lib/capability.ts'), 'utf8');
    const ids = identifiersInFunctions(src, ['serves', 'servesBatch', 'filterServed']);
    expect(Object.keys(ids).sort()).toEqual(['filterServed', 'serves', 'servesBatch']);
    for (const [fn, names] of Object.entries(ids)) {
      expect(names, fn).not.toContain('isFeatureFlagEnabled');
      expect(names, fn).not.toContain('computeAdmits');
      expect(names, fn).not.toContain('admits');
    }
  });

  describe('negative fixtures (the rules actually bite)', () => {
    it('Rule A fails on a raw useFeatureFlag(release-v2-0-feature) in an entry point', () => {
      const fixture = `
        'use client';
        import { useFeatureFlag } from '@alga-psa/ui/hooks';
        export default function CoManagedPage() {
          const { enabled } = useFeatureFlag('release-v2-0-feature');
          return enabled ? null : null;
        }`;
      expect(ruleAViolations(fixture)).toHaveLength(1);
      expect(ruleAViolations(`export const x = 'something-else';`)).toHaveLength(0);
    });

    it('Rule B fails on any release-v1-6-feature reference', () => {
      const fixture = `const on = await isFeatureFlagEnabled("release-v1-6-feature", { tenantId });`;
      expect(ruleBViolations(fixture)).toHaveLength(1);
    });

    it('Rule C fails when serves references the flag evaluator', () => {
      const fixture = `
        export async function serves(c, t) { return isFeatureFlagEnabled('x', { tenantId: t }); }
        async function servesBatch() {}
        export async function filterServed() {}`;
      expect(identifiersInFunctions(fixture, ['serves']).serves).toContain('isFeatureFlagEnabled');
    });
  });
});

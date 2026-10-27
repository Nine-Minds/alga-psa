import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Worker boot safety (plan 2.6): jobs, Temporal worker and subscribers import
 * only the pure entry `@alga-psa/core/capability`. The import graph reachable
 * from it and from the jobs adapter must be Next-free, and the pure entry must
 * keep loading and fail closed when resolution is forced to fail.
 */
const REPO = resolve(__dirname, '../../../../..');
const ENTRIES = [
  'packages/core/src/lib/capability.ts',
  'packages/jobs/src/lib/jobs/capabilityJob.ts',
];

function importsOf(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly)) out.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(n.arguments[0])) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && /\.[tj]sx?$/.test(c)) return c;
  }
  return null;
}

function closure(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const stack = [join(REPO, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of importsOf(f)) {
      if (spec.startsWith('.')) {
        const r = resolveRel(f, spec);
        if (r) stack.push(r);
      } else bare.add(spec);
    }
  }
  return { files, bare };
}

describe('worker boot safety', () => {
  it.each(ENTRIES)('%s reaches no Next module and never the Next-bound subpath', (entry) => {
    const { bare } = closure(entry);
    const bad = [...bare].filter((s) => s === 'next' || s.startsWith('next/') || s.includes('capability/server') || s.startsWith('react') || s === 'posthog-js');
    expect(bad).toEqual([]);
  });

  it('the jobs adapter imports only the pure capability entry', () => {
    const specs = importsOf(join(REPO, ENTRIES[1]));
    expect(specs.filter((s) => s.includes('capability'))).toEqual(['@alga-psa/core/capability']);
  });

  it('loads and fails closed when flag evaluation and resolvers are forced to fail', async () => {
    vi.resetModules();
    vi.doMock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: vi.fn(async () => { throw new Error('boom'); }) }));
    vi.doMock('../../../../../packages/core/src/lib/features', () => ({ isFeatureFlagEnabled: vi.fn(async () => { throw new Error('boom'); }) }));
    const cap = await import('../../../../../packages/core/src/lib/capability');
    cap.registerCapabilityEligibility('co-managed', async () => { throw new Error('db down'); });
    cap.registerCapabilityParticipation('co-managed', async () => { throw new Error('db down'); });
    cap.clearCapabilityCache();
    await expect(cap.serves('co-managed', 't1')).resolves.toMatchObject({ served: false });
    await expect(cap.admits('co-managed', 't1')).resolves.toMatchObject({ admitted: false });
    await expect(cap.activityServesCapability('co-managed', 't1')).resolves.toEqual({ skipped: true, capability: 'co-managed' });
    vi.doUnmock('@alga-psa/core/features');
    vi.doUnmock('../../../../../packages/core/src/lib/features');
  });
});

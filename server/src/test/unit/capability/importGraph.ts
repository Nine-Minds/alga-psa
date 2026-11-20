import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export const REPO = resolve(__dirname, '../../../../..');

// Every closure walks a large shared subgraph; each file is read and parsed once per process, not once per entry or
// per test. A cache hit must not touch the disk: on a loaded CI runner the re-read of ~1,100 files that a verifying
// compare needs took longer than the parse itself (run 41148754710, shard 1: the warm Rule D retry still spent 39 s
// in I/O behind four forks writing coverage). An injected source still wins, keyed on the exact text.
const parsedImports = new Map<string, { source: string; imports: string[]; fromDisk: boolean }>();

export function importsOf(file: string, source?: string): string[] {
  const hit = parsedImports.get(file);
  if (hit && (source === undefined ? hit.fromDisk : hit.source === source)) return hit.imports;
  const text = source ?? readFileSync(file, 'utf8');
  const imports = parseImports(file, text);
  parsedImports.set(file, { source: text, imports, fromDisk: source === undefined });
  return imports;
}

function parseImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
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

function tryFile(base: string): string | null {
  const stripped = base.replace(/\.(js|mjs)$/, '');
  for (const c of [base, `${stripped}.ts`, `${stripped}.tsx`, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && /\.[tj]sx?$/.test(c)) return c;
  }
  return null;
}

const resolved = new Map<string, string | null>();

/** Resolve a specifier to a repo source file, or null for third-party/unresolvable. */
export function resolveSpecifier(from: string, spec: string): string | null {
  const key = `${dirname(from)}\0${spec}`;
  if (!resolved.has(key)) resolved.set(key, resolveUncached(from, spec));
  return resolved.get(key)!;
}

function resolveUncached(from: string, spec: string): string | null {
  if (spec.startsWith('.')) return tryFile(resolve(dirname(from), spec));
  const m = /^@alga-psa\/([^/]+)(?:\/(.+))?$/.exec(spec);
  if (!m) return null;
  const [, pkg, sub] = m;
  if (pkg === 'core' && sub === 'capability') return join(REPO, 'packages/core/src/lib/capability.ts');
  if (pkg === 'core' && sub === 'capability/server') return join(REPO, 'packages/core/src/capability/server.ts');
  if (pkg === 'shared') return tryFile(join(REPO, 'shared', sub ?? 'index'));
  const root = join(REPO, 'packages', pkg, 'src');
  return (sub ? tryFile(join(root, sub)) ?? tryFile(join(root, 'lib', sub)) : null) ?? tryFile(join(root, 'index'));
}

export interface Closure {
  files: Set<string>;
  bare: Set<string>;
  /** specifier -> first importer, for failure messages */
  via: Map<string, string>;
}

/** Transitive import closure starting at one entry (repo-relative). */
export function closure(entry: string, readSource?: (file: string) => string | undefined): Closure {
  const files = new Set<string>();
  const bare = new Set<string>();
  const via = new Map<string, string>();
  const stack = [join(REPO, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readSource?.(f);
    for (const spec of importsOf(f, src)) {
      const r = resolveSpecifier(f, spec);
      if (r) stack.push(r);
      else {
        bare.add(spec);
        if (!via.has(spec)) via.set(spec, f);
      }
    }
  }
  return { files, bare, via };
}

export const isForbiddenForWorkers = (spec: string) =>
  spec === 'next' || spec.startsWith('next/') || spec === 'posthog-js' || spec.startsWith('posthog-js/');

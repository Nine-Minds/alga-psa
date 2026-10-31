import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export const REPO = resolve(__dirname, '../../../../..');

export function importsOf(file: string, source?: string): string[] {
  const sf = ts.createSourceFile(file, source ?? readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
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

/** Resolve a specifier to a repo source file, or null for third-party/unresolvable. */
export function resolveSpecifier(from: string, spec: string): string | null {
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

interface Edge {
  spec: string;
  /** Resolved repo source file, or null for a bare (third-party/unresolvable) specifier. */
  target: string | null;
}

/**
 * Per-file import edges of on-disk sources, parsed once per process. Entries share most of their graph
 * (every worker reaches the same packages), so re-parsing per entry multiplied the walk by the entry count.
 */
const diskEdges = new Map<string, Edge[]>();
let parses = 0;

function edgesOf(file: string, source?: string): Edge[] {
  const parse = () => {
    parses++;
    return importsOf(file, source).map((spec) => ({ spec, target: resolveSpecifier(file, spec) }));
  };
  if (source !== undefined) return parse();
  let edges = diskEdges.get(file);
  if (!edges) diskEdges.set(file, (edges = parse()));
  return edges;
}

/** Number of source files parsed so far (overridden sources included); for asserting the graph is shared. */
export const importGraphParseCount = () => parses;

/** Transitive import closure starting at one entry (repo-relative). `readSource` overrides are never cached. */
export function closure(entry: string, readSource?: (file: string) => string | undefined): Closure {
  const files = new Set<string>();
  const bare = new Set<string>();
  const via = new Map<string, string>();
  const stack = [join(REPO, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const { spec, target } of edgesOf(f, readSource?.(f))) {
      if (target) stack.push(target);
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

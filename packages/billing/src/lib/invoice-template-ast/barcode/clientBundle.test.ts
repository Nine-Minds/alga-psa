/**
 * Bundle check (C1 definition of done #6): neither `qrcode` nor `bwip-js` may be reachable from client
 * bundles. Walks the import graph (static AND dynamic imports; bundlers chunk dynamic imports too) from
 * every 'use client' module in this package, and fails if it reaches a *.server module, the server-only
 * renderer entry, or either library.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');
const FORBIDDEN_SPECIFIER = /^(qrcode|bwip-js)(\/|$)/;
const FORBIDDEN_FILE = /(\.server\.tsx?$|invoice-template-ast\/server-render\.ts$|services\/labelPdfService\.ts$)/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

const resolveRelative = (from: string, spec: string): string | null => {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

// `import type` / `export type` are erased; `import {type X}` mixed forms are rare here and still counted.
const IMPORT_RE = /(?<!(?:import|export)\s+type\s[^;]*?)(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)['"]([^'"]+)['"]/g;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
const hasDirective = (source: string, directive: string) =>
  new RegExp(`^\\s*['"]${directive}['"]`).test(stripComments(source).slice(0, 400));
const isServerActionModule = (source: string) => hasDirective(source, 'use server');

describe('client bundle isolation of barcode encoders', () => {
  it('no use-client module reaches qrcode, bwip-js, *.server modules or the server renderer', () => {
    const files = walk(SRC);
    const clientRoots = files.filter((f) => hasDirective(readFileSync(f, 'utf8'), 'use client'));
    expect(clientRoots.length).toBeGreaterThan(10);

    const violations: string[] = [];
    const seen = new Set<string>();
    const stack = clientRoots.map((f) => [f, f] as const);
    while (stack.length) {
      const [file, root] = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const raw = readFileSync(file, 'utf8');
      // A 'use server' module is an RPC boundary: the client bundle gets a stub, not its imports.
      if (file !== root && isServerActionModule(raw)) continue;
      const source = stripComments(raw);
      for (const match of source.matchAll(IMPORT_RE)) {
        const spec = match[1];
        if (FORBIDDEN_SPECIFIER.test(spec)) violations.push(`${file} imports ${spec} (from client root ${root})`);
        if (!spec.startsWith('.')) continue;
        const target = resolveRelative(file, spec);
        if (!target) continue;
        if (FORBIDDEN_FILE.test(target)) violations.push(`${file} -> ${target} (from client root ${root})`);
        else stack.push([target, root]);
      }
    }
    expect(violations).toEqual([]);
  });
});

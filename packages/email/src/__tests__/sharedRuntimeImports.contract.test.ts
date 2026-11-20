import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Packages that alias `@alga-psa/email` to its source (e.g. @alga-psa/sla's Vitest config) load this
 * package's `@alga-psa/shared/<subpath>` imports through shared's exports map, which points at
 * `shared/dist`. A subpath shared's tsup build never emits fails there with "Cannot find package",
 * even though this package's own tests (which alias shared to source) pass. So every runtime import
 * of shared from this package's source must be a shared tsup entry.
 */

const EMAIL_SRC = path.resolve(__dirname, '..');
const SHARED_TSUP = path.resolve(__dirname, '../../../../shared/tsup.config.ts');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Value (non-type-only) `@alga-psa/shared/<subpath>` specifiers in a source file. */
export function runtimeSharedSubpaths(text: string): string[] {
  const out: string[] = [];
  const pattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s*['"]@alga-psa\/shared\/([^'"]+)['"]|\bimport\s*\(\s*['"]@alga-psa\/shared\/([^'"]+)['"]/g;
  for (const m of text.matchAll(pattern)) {
    if (m[4]) out.push(m[4]);
    else if (!m[2]) out.push(m[3]);
  }
  return out.map((s) => s.replace(/\.js$/, ''));
}

function sharedTsupEntries(): Set<string> {
  const config = readFileSync(SHARED_TSUP, 'utf8');
  return new Set([...config.matchAll(/^\s*['"]([^'"]+)['"]\s*:\s*['"][^'"]+\.tsx?['"]/gm)].map((m) => m[1]));
}

describe('@alga-psa/email runtime imports of @alga-psa/shared', () => {
  it('distinguishes value imports from type-only imports', () => {
    expect(
      runtimeSharedSubpaths(
        "import type { A } from '@alga-psa/shared/a';\nimport { b } from '@alga-psa/shared/b';\nconst c = await import('@alga-psa/shared/c.js');",
      ),
    ).toEqual(['b', 'c']);
  });

  it('only imports shared subpaths that shared/dist emits', () => {
    const entries = sharedTsupEntries();
    const missing: string[] = [];
    for (const file of sourceFiles(EMAIL_SRC)) {
      for (const subpath of runtimeSharedSubpaths(readFileSync(file, 'utf8'))) {
        if (!entries.has(subpath) && !entries.has(`${subpath}/index`)) {
          missing.push(`${path.relative(EMAIL_SRC, file)}: @alga-psa/shared/${subpath}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

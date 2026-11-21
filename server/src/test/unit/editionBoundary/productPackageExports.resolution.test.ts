/**
 * Shared workspace packages (packages/**) are consumed by many vitest/tsx/node
 * runners that do NOT carry the server's per-edition aliases. Any
 * `@product/<pkg>/<subpath>` they import must therefore resolve through the
 * product package's own `exports` map, or every consumer that transitively
 * loads the importing module fails at import time (e.g. a missing
 * "./entry" specifier in @product/service-principals broke the documents,
 * projects, billing and client-portal unit suites via packages/auth).
 *
 * Edition selection still happens in server/next.config.mjs, which aliases the
 * physical `<pkg>/entry.ts` file to `<pkg>/ee/entry.ts` for EE builds.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const PRODUCT_SUBPATH_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](@product\/[a-z0-9-]+\/[^'"]+)['"]/g;

function collectSharedPackageProductImports(): Array<{ file: string; specifier: string }> {
  const out = execFileSync(
    'git',
    ['grep', '-lE', '@product/[a-z0-9-]+/', '--', 'packages/*.ts', 'packages/*.tsx', 'packages/*.mts', 'packages/*.js', 'packages/*.mjs'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
  if (!out) return [];
  const found: Array<{ file: string; specifier: string }> = [];
  for (const rel of out.split('\n')) {
    // Product packages themselves are edition implementations, not consumers.
    if (rel.startsWith('packages/product-')) continue;
    const content = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    for (const match of content.matchAll(PRODUCT_SUBPATH_IMPORT)) {
      found.push({ file: rel, specifier: match[1] });
    }
  }
  return found;
}

describe('@product/* subpaths imported by shared packages', () => {
  const imports = collectSharedPackageProductImports();

  it('finds the known shared-package consumer of @product/service-principals/entry', () => {
    expect(imports).toContainEqual({
      file: 'packages/auth/src/services/apiKeyService.ts',
      specifier: '@product/service-principals/entry',
    });
  });

  it('every import resolves through the product package exports map (no aliases)', () => {
    const unresolved: string[] = [];
    for (const { file, specifier } of imports) {
      const requireFromFile = createRequire(resolve(REPO_ROOT, file));
      try {
        requireFromFile.resolve(specifier);
      } catch (error) {
        unresolved.push(`${file}: ${specifier} (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});

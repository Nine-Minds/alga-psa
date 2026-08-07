import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The global '@alga-psa/auth' mock in src/test/setup.ts is a full factory:
 * any name production code value-imports but the factory omits makes vitest
 * throw at the import binding, which surfaces as opaque 500s in every API
 * test (the runWithApiKeyUser nightly break, PR #3120). This contract
 * enumerates every prod value-import of the package and requires the mock to
 * export it, so adding an export to '@alga-psa/auth' fails here — loudly and
 * with the name — instead of in the next nightly.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.next',
  'test',
  'tests',
  '__tests__',
  'test-utils',
  'e2e',
]);

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      collectSourceFiles(path.join(dir, entry.name), files);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function scanRoots(): string[] {
  const roots = [path.join(REPO_ROOT, 'server/src')];
  const packagesDir = path.join(REPO_ROOT, 'packages');
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    // packages/auth importing itself is not a mock consumer.
    if (!entry.isDirectory() || entry.name === 'auth') {
      continue;
    }
    const src = path.join(packagesDir, entry.name, 'src');
    if (fs.existsSync(src)) {
      roots.push(src);
    }
  }
  return roots;
}

interface ScanResult {
  namedImports: Map<string, string[]>;
  namespaceImportFiles: string[];
}

const NAMED_IMPORT_RE = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]@alga-psa\/auth['"]/g;
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+\w+\s+from\s+['"]@alga-psa\/auth['"]/;

function scanProdImports(): ScanResult {
  const namedImports = new Map<string, string[]>();
  const namespaceImportFiles: string[] = [];

  for (const root of scanRoots()) {
    for (const file of collectSourceFiles(root)) {
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('@alga-psa/auth')) {
        continue;
      }
      const rel = path.relative(REPO_ROOT, file);

      if (NAMESPACE_IMPORT_RE.test(content)) {
        namespaceImportFiles.push(rel);
      }

      for (const match of content.matchAll(NAMED_IMPORT_RE)) {
        if (match[1]) {
          continue; // import type { ... } — no runtime binding
        }
        for (const rawSpecifier of match[2].split(',')) {
          const specifier = rawSpecifier.trim();
          if (!specifier || specifier.startsWith('type ')) {
            continue;
          }
          const name = specifier.split(/\s+as\s+/)[0].trim();
          const usages = namedImports.get(name) ?? [];
          usages.push(rel);
          namedImports.set(name, usages);
        }
      }
    }
  }

  return { namedImports, namespaceImportFiles };
}

describe('global @alga-psa/auth mock contract', () => {
  const scan = scanProdImports();

  it('finds the known baseline imports (scanner sanity check)', () => {
    for (const name of ['withAuth', 'hasPermission', 'getCurrentUser', 'runWithApiKeyUser']) {
      expect(scan.namedImports.has(name), `scanner should find prod imports of ${name}`).toBe(true);
    }
  });

  it('exports every name production code value-imports', async () => {
    const mocked = await import('@alga-psa/auth');
    const missing = [...scan.namedImports.entries()]
      .filter(([name]) => !(name in mocked))
      .map(([name, files]) => `${name} (e.g. ${files[0]})`);

    expect(
      missing,
      'Add these exports to the @alga-psa/auth factory in src/test/setup.ts — a missing one 500s every API test',
    ).toEqual([]);
  });

  it('has no namespace imports in production code (they defeat this contract)', () => {
    expect(scan.namespaceImportFiles).toEqual([]);
  });

  it('getCurrentUser honors the runWithApiKeyUser override, like production', async () => {
    const { getCurrentUser, runWithApiKeyUser, getApiKeyUserOverride } = await import('@alga-psa/auth');
    const apiKeyUser = { user_id: 'api-key-user', tenant: 'api-key-tenant', roles: [] };

    expect(getApiKeyUserOverride()).toBeUndefined();

    const seen = await runWithApiKeyUser(apiKeyUser as never, async () => ({
      current: await getCurrentUser(),
      override: getApiKeyUserOverride(),
    }));
    expect(seen.current).toMatchObject({ user_id: 'api-key-user' });
    expect(seen.override).toMatchObject({ user_id: 'api-key-user' });

    expect(getApiKeyUserOverride()).toBeUndefined();
    await expect(getCurrentUser()).resolves.toMatchObject({
      user_id: '00000000-0000-0000-0000-000000000001',
    });
  });
});

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it } from 'vitest';

// The authorization kernel imports published @alga-psa/db subpaths (e.g.
// `@alga-psa/db/tenantTableManifest`). Unit CI runs without packages/db/dist, so
// every suite that loads the kernel must resolve those subpaths to db source
// through its own aliases; otherwise Node falls back to the exports map's dist
// target and the whole suite fails to import. These are the suites that load
// the kernel and keep their own alias lists.
const PACKAGES_DIR = path.resolve(__dirname, '../../..');
const CONSUMER_PACKAGES = ['authorization', 'co-managed', 'scheduling', 'integrations', 'billing'];

type Alias = { find: string | RegExp; replacement: string };

function dbSourceSubpaths(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGES_DIR, 'db', 'package.json'), 'utf8'));
  return Object.entries<{ types?: string }>(manifest.exports)
    .filter(([subpath, entry]) => subpath !== '.' && entry.types?.startsWith('./src/'))
    .map(([subpath]) => `@alga-psa/db${subpath.slice(1)}`);
}

function resolveThroughAliases(aliases: Alias[], specifier: string): string | null {
  const alias = aliases.find(({ find }) =>
    typeof find === 'string' ? specifier === find || specifier.startsWith(`${find}/`) : find.test(specifier),
  );
  if (!alias) return null;
  return typeof alias.find === 'string'
    ? alias.replacement + specifier.slice(alias.find.length)
    : specifier.replace(alias.find, alias.replacement);
}

function isSourceFile(target: string): boolean {
  const candidates = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')];
  return candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

describe('published @alga-psa/db subpaths resolve to source in kernel-loading suites', () => {
  const subpaths = dbSourceSubpaths();

  it('covers the subpath the kernel imports', () => {
    expect(subpaths).toContain('@alga-psa/db/tenantTableManifest');
  });

  it.each(CONSUMER_PACKAGES)('packages/%s/vitest.config.ts', async (pkg) => {
    const configFile = path.join(PACKAGES_DIR, pkg, 'vitest.config.ts');
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile);
    const aliases = (loaded?.config.resolve?.alias ?? []) as Alias[];
    expect(Array.isArray(aliases)).toBe(true);

    const unresolved = subpaths.filter((specifier) => {
      const target = resolveThroughAliases(aliases, specifier);
      return target === null || !isSourceFile(target);
    });
    expect(unresolved).toEqual([]);
  }, 60_000);
});

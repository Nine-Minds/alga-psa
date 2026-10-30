import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Published-surface contract.
 *
 * The server's webpack and tsconfig aliases map most `@alga-psa/<pkg>/<subpath>`
 * imports straight to source, so a subpath a package never publishes still
 * builds there. Every other consumer resolves through the package's exports map:
 * ee/server's tsconfig (its own `paths` replace the base aliases), the temporal
 * worker, and Node loading the tsup dist. For the packages below, every imported
 * subpath is published, so this one rule holds for all of them: each subpath
 * imported anywhere in the repo matches an exports key, and each dist target a
 * tsup build owns has a tsup entry that emits it.
 * Add a package once its imported surface is fully published; never remove one.
 */
const PUBLISHED_SURFACE_PACKAGES = [
  '@alga-psa/agent-tooling',
  '@alga-psa/authorization',
  '@alga-psa/block-content',
  '@alga-psa/co-managed',
  '@alga-psa/documents',
  '@alga-psa/formatting',
  '@alga-psa/inventory',
  '@alga-psa/list-views',
  '@alga-psa/marketing',
  '@alga-psa/migration-connectors',
  '@alga-psa/msp-composition',
  '@alga-psa/opportunities',
  '@alga-psa/portal-shared',
  '@alga-psa/predicates',
  '@alga-psa/search',
  '@alga-psa/telephony',
  '@alga-psa/user-activities',
  '@alga-psa/user-composition',
  '@alga-psa/validation',
  '@alga-psa/workflow-streams',
] as const;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCAN_ROOTS = ['server/src', 'ee', 'packages', 'services', 'shared'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.next-review', 'coverage', '.turbo']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](@alga-psa\/[a-z0-9-]+)(\/[^'"]+)?['"]/gm;

type ExportEntry = string | { types?: string; import?: string; require?: string; default?: string };
interface PublishedPackage {
  name: string;
  dir: string;
  exports: Record<string, ExportEntry>;
  tsupEntries: string[] | null;
}

function loadPackages(): Map<string, PublishedPackage> {
  const packages = new Map<string, PublishedPackage>();
  for (const dirName of readdirSync(path.join(REPO, 'packages'))) {
    const dir = path.join(REPO, 'packages', dirName);
    const manifest = path.join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; exports?: Record<string, ExportEntry> };
    if (!pkg.name || !pkg.exports || typeof pkg.exports !== 'object') continue;
    packages.set(pkg.name, { name: pkg.name, dir, exports: pkg.exports, tsupEntries: readTsupEntries(dir) });
  }
  return packages;
}

/** The string-literal `entry: [...]` of a package's tsup.config.ts, or null when it has none. */
function readTsupEntries(dir: string): string[] | null {
  const config = path.join(dir, 'tsup.config.ts');
  if (!existsSync(config)) return null;
  const entry = /\bentry\s*:\s*\[([\s\S]*?)\]/.exec(readFileSync(config, 'utf8'));
  if (!entry) return null;
  return [...entry[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Node's exports-map key matching: exact, or a single `*` standing for any substring. */
function matchesExportKey(key: string, subpath: string): boolean {
  const star = key.indexOf('*');
  if (star < 0) return key === subpath;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return subpath.length >= prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix);
}

/** tsup entry globs: `**` spans directories (with its trailing `/`), `*` stays within one segment. */
function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*' && i + 2 === glob.length) {
      pattern += '.*';
      i += 1;
    } else if (char === '*' && glob[i + 1] === '*') {
      pattern += '(?:.*/)?';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else {
      pattern += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function coveredByTsup(entries: string[], source: string): boolean {
  const excluded = entries.filter((e) => e.startsWith('!')).some((e) => globToRegExp(e.slice(1)).test(source));
  return !excluded && entries.filter((e) => !e.startsWith('!')).some((e) => globToRegExp(e).test(source));
}

function walk(dir: string, acc: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (SOURCE_FILE.test(entry.name)) acc.push(full);
  }
}

export function unpublishedSubpathImports(
  packages: Map<string, PublishedPackage>,
  files: Array<{ path: string; text: string }>,
  published: readonly string[],
): string[] {
  const surface = new Set(published);
  const failures: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(SPECIFIER)) {
      const [, name, rest] = match;
      if (!rest || !surface.has(name)) continue;
      const pkg = packages.get(name);
      if (!pkg) continue;
      const subpath = `.${rest}`;
      if (!Object.keys(pkg.exports).some((key) => matchesExportKey(key, subpath))) {
        failures.push(`${file.path}: '${name}${rest}' is not in ${name}'s exports map`);
      }
    }
  }
  return failures;
}

export function unbuiltExportTargets(pkg: PublishedPackage): string[] {
  const failures: string[] = [];
  for (const [key, entry] of Object.entries(pkg.exports)) {
    if (typeof entry === 'string' || key.includes('*')) continue;
    const dist = entry.import ?? entry.require;
    if (!pkg.tsupEntries || !entry.types || !dist?.startsWith('./dist/')) continue;
    const source = entry.types.replace(/^\.\//, '');
    if (!coveredByTsup(pkg.tsupEntries, source)) {
      failures.push(`${pkg.name} export '${key}': ${dist} has no tsup entry building ${source}`);
    }
  }
  return failures;
}

const SELF = fileURLToPath(import.meta.url);
const packages = loadPackages();
const repoFiles = SCAN_ROOTS.flatMap((root) => {
  const acc: string[] = [];
  walk(path.join(REPO, root), acc);
  return acc;
}).filter((file) => file !== SELF).map((file) => ({ path: path.relative(REPO, file), text: readFileSync(file, 'utf8') }));

describe('published package surfaces', () => {
  it('lists only packages that exist and carry an exports map', () => {
    expect(PUBLISHED_SURFACE_PACKAGES.filter((name) => !packages.has(name))).toEqual([]);
  });

  it('every imported subpath of a published-surface package is in its exports map', () => {
    expect(unpublishedSubpathImports(packages, repoFiles, PUBLISHED_SURFACE_PACKAGES)).toEqual([]);
  });

  it('every tsup-built dist target in an exports map has a tsup entry', () => {
    expect(PUBLISHED_SURFACE_PACKAGES.flatMap((name) => unbuiltExportTargets(packages.get(name)!))).toEqual([]);
  });
});

describe('published package surfaces — negative fixtures', () => {
  const search = packages.get('@alga-psa/search')!;

  it('flags a subpath import the exports map does not publish', () => {
    const files = [{ path: 'server/src/fixture.ts', text: "import { x } from '@alga-psa/search/notPublished';" }];
    expect(unpublishedSubpathImports(packages, files, PUBLISHED_SURFACE_PACKAGES)).toEqual([
      "server/src/fixture.ts: '@alga-psa/search/notPublished' is not in @alga-psa/search's exports map",
    ]);
  });

  it('accepts wildcard keys and ignores packages outside the published surface', () => {
    const files = [
      {
        path: 'server/src/fixture.ts',
        text: [
          "import { y } from '@alga-psa/search/indexers/tickets';",
          "const z = await import('@alga-psa/search/projectSearchAccess');",
          "import { w } from '@alga-psa/tickets/actions/ticketActions';",
        ].join('\n'),
      },
    ];
    expect(unpublishedSubpathImports(packages, files, PUBLISHED_SURFACE_PACKAGES)).toEqual([]);
  });

  it('flags an export whose dist target no tsup entry builds', () => {
    const withoutEntry = {
      ...search,
      tsupEntries: (search.tsupEntries ?? []).filter((entry) => entry !== 'src/projectSearchAccess.ts'),
    };
    expect(unbuiltExportTargets(withoutEntry)).toEqual([
      "@alga-psa/search export './projectSearchAccess': ./dist/projectSearchAccess.mjs has no tsup entry building src/projectSearchAccess.ts",
    ]);
  });
});

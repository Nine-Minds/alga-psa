import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Client creation has a fixed list of prerequisites — a default billing
 * profile, a system-managed default contract when the client is
 * billing-configured, default tax settings, and the tenant's configured default
 * currency. Every caller used to repeat that list by hand and each one forgot a
 * different member of it (prod migration 20261023002700 had to backfill the
 * billing profiles one path missed).
 *
 * `createClientWithDefaults` is now the only place that inserts a `clients`
 * row. This test fails on a new direct insert in any of the styles the codebase
 * uses, so the next creation path has to go through the seam.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SCAN_ROOTS = [
  'server/src',
  'shared',
  'ee/server/src',
  'ee/temporal-workflows/src',
  // plus every packages/<pkg>/src, expanded below
];

/** The one module allowed to insert a client row. */
const SEAM = 'shared/models/clientCreation.ts';

/** No production path is exempt. */
const ALLOWLIST = new Set<string>([]);

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '__tests__',
  '__mocks__',
  'migrations',
  'seeds',
  'test',
  'tests',
  'test-utils',
  'testUtils',
  'fixtures',
  'factories',
]);

function isTestOrFixtureFile(relativePath: string): boolean {
  return /\.(test|spec|contract\.test)\.tsx?$/.test(relativePath)
    || /(^|\/)(testUtils|test-utils|testHelpers|test-helpers|fixtures|factories)\//.test(relativePath)
    || /(Factory|Fixtures|TestHelpers)\.tsx?$/.test(relativePath);
}

function collectSourceFiles(absoluteRoot: string, relativeRoot: string, into: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(absoluteRoot);
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = path.join(absoluteRoot, entry);
    const relative = `${relativeRoot}/${entry}`;
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(absolute);
    } catch {
      continue; // dangling symlink (build scratch directories leave them behind)
    }

    if (stats.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      collectSourceFiles(absolute, relative, into);
      continue;
    }

    if (!/\.tsx?$/.test(entry)) continue;
    if (isTestOrFixtureFile(relative)) continue;
    into.push(relative);
  }
}

function scanRoots(): string[] {
  const roots = [...SCAN_ROOTS];

  const packagesDir = path.join(REPO_ROOT, 'packages');
  for (const pkg of readdirSync(packagesDir)) {
    if (pkg === 'node_modules') continue;
    const src = path.join(packagesDir, pkg, 'src');
    try {
      if (statSync(src).isDirectory()) roots.push(`packages/${pkg}/src`);
    } catch {
      // package without a src/ directory
    }
  }

  const files: string[] = [];
  for (const root of roots) {
    collectSourceFiles(path.join(REPO_ROOT, root), root, files);
  }
  return files;
}

/**
 * Every shape the codebase uses to write to a table. `.into('clients')` is
 * always an insert target; the other forms are only a finding when `.insert`
 * follows the table root.
 */
const DIRECT_INSERT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    // db.table('clients').insert(...) / tenantDb(trx, tenant).table<IClient>('clients').insert(...)
    label: ".table('clients') … .insert",
    pattern: /\.table\s*(?:<[^<>()]*>\s*)?\(\s*['"]clients['"]\s*\)\s*\.insert\b/,
  },
  {
    // knex.insert(row).into('clients')
    label: ".into('clients')",
    pattern: /\.into\s*\(\s*['"]clients['"]\s*\)/,
  },
  {
    // Any call that takes 'clients' as a table argument and is inserted into:
    // knex('clients').insert(...), trx('clients').insert(...),
    // tenantScopedTable(tx, 'clients').insert(...),
    // tenantScopedTable(trx, 'clients', tenant).insert(...).
    // The lookbehind leaves `.table('clients')` to the pattern above so one
    // offending line is reported once.
    label: "<fn>('clients') … .insert",
    pattern: /(?<!\.)\b[A-Za-z_$][\w$]*\s*\(\s*(?:[^()'"]*,\s*)?['"]clients['"]\s*(?:,\s*[^()'"]*)?\)\s*\.insert\b/,
  },
];

/** Collapses the chain across line breaks so `.insert` on the next line still matches. */
function normalize(source: string): string {
  return source.replace(/\s+/g, ' ');
}

describe('client creation seam contract', () => {
  const files = scanRoots();

  it('scans a meaningful slice of the repository', () => {
    // Guards the walker itself: a broken root list would make this test vacuous.
    expect(files.length).toBeGreaterThan(2000);
    expect(files).toContain(SEAM);
    expect(files).toContain('packages/clients/src/actions/clientActions.ts');
    expect(files).toContain('ee/temporal-workflows/src/db/tenant-operations.ts');
  });

  it('recognises every insert style the codebase writes tables with', () => {
    // Without this the gate can pass while being blind: the business-operation
    // ops wrote `tenantScopedTable(tx, 'clients').insert(...)` and no pattern
    // saw it.
    const shouldMatch = [
      "await db.table('clients').insert(row);",
      "await tenantDb(trx, tenant).table<IClient>('clients').insert(row);",
      "await trx.insert(row).into('clients');",
      "await knex('clients').insert(row);",
      "await trx('clients').insert(row);",
      "await tenantScopedTable(tx, 'clients').insert(createRow);",
      "await tenantScopedTable(trx, 'clients', tenant).insert(row);",
      "await clientsTable('clients').insert(row);",
    ];
    const shouldNotMatch = [
      "const columns = await getTableColumns(tx, 'clients');",
      "await tenantScopedTable(tx, 'clients').where('client_id', id).update(patch);",
      "await db.table('client_locations').insert(row);",
      "await db.table('clients_extra').insert(row);",
    ];

    for (const sample of shouldMatch) {
      expect(
        DIRECT_INSERT_PATTERNS.some(({ pattern }) => pattern.test(normalize(sample))),
        `gate is blind to: ${sample}`
      ).toBe(true);
    }
    for (const sample of shouldNotMatch) {
      expect(
        DIRECT_INSERT_PATTERNS.some(({ pattern }) => pattern.test(normalize(sample))),
        `gate false-positives on: ${sample}`
      ).toBe(false);
    }
  });

  it('routes every clients insert through createClientWithDefaults', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file === SEAM || ALLOWLIST.has(file)) continue;
      const source = normalize(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
      for (const { label, pattern } of DIRECT_INSERT_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${file} (${label})`);
        }
      }
    }

    expect(
      offenders,
      'These files insert a clients row directly. Call createClientWithDefaults from '
        + "'@alga-psa/shared/models/clientCreation' instead so the client gets its default "
        + 'billing profile, default contract, tax settings and the tenant default currency.'
    ).toEqual([]);
    // Reads every non-test source file under several repo roots (thousands of
    // files). Under a loaded, highly parallel CI run (Nx fans this package's
    // suite out alongside ~50 other projects) that I/O comfortably exceeds
    // vitest's 5s default; it finishes in well under 1s on a quiet machine.
  }, 30_000);

  it('keeps the seam itself as the single insert site', () => {
    const seamSource = normalize(readFileSync(path.join(REPO_ROOT, SEAM), 'utf8'));

    expect(seamSource).toMatch(DIRECT_INSERT_PATTERNS[0].pattern);
    expect(seamSource).toContain("ensureClientDefaultBillingProfile(trx, tenant, created.client_id");
    expect(seamSource).toContain('ensureDefaultContractForClientIfBillingConfigured(trx');
    expect(seamSource).toContain('initializeClientDefaultTax(trx, tenant, created.client_id)');
  });
});

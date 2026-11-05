import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findSourceBoundaryViolations } from '../../../../scripts/lib/source-boundary';

/**
 * Credentials vault is an EE-only (Pro) feature. Its DB schema lives in
 * ee/server/migrations and its runtime code in ee/ + packages/ee. This guard
 * fails if any other tracked source file touches the credentials vault tables
 * or imports EE credential modules, so the feature cannot leak back into CE.
 * Shared lifecycle and write-policy catalogs may declare table metadata, but
 * cannot execute vault queries or import vault implementations.
 *
 * It targets table-name usage and module paths, not the bare word "credentials"
 * (which is common in OAuth/auth/integration code).
 */

const repoRoot = path.resolve(__dirname, '../../../..');

// Whole trees owned by EE.
const ALLOWED_PREFIXES = ['ee/', 'packages/ee/'];

// Explicit allowlist (no broad globs).
const ALLOWED_FILES = new Set<string>([
  // This guard itself (contains the patterns).
  'server/src/test/unit/credentialsEditionBoundary.contract.test.ts',

  // CE no-op placeholders for migrations whose real files live in ee/server/migrations.
  'server/migrations/20260811100000_create_credentials_tables.cjs',
  'server/migrations/20260811110000_add_credential_permissions.cjs',
  'server/migrations/20260812100000_disable_rls_on_credential_tables.cjs',
  'server/migrations/20260812110000_expand_credential_associations_entity_types.cjs',
  'server/migrations/20260828120000_add_credential_audit_permission.cjs',

  // Migration metadata / RBAC catalog (data, not logic).
  'server/migrations/utils/tenantDb.cjs',
  'server/migrations/utils/permissions/catalog.cjs',

  // Boundary wrappers: thin `@enterprise` dynamic imports resolved to CE stubs in packages/ee.
  'packages/assets/src/components/tabs/AssetCredentialsSection.tsx',
  'packages/clients/src/components/clients/useCredentialsVaultTab.ts',
  'packages/clients/src/components/clients/ClientCredentialsTab.tsx',
  'packages/clients/src/components/clients/ClientDetails.tsx',
  'packages/clients/src/components/contacts/ContactCredentialsSection.tsx',
  'packages/documents/src/components/DocumentCredentialsSection.tsx',
  'packages/projects/src/components/TaskCredentialsSection.tsx',
  'packages/tickets/src/components/ticket/TicketCredentialsSection.tsx',
  'server/src/app/msp/credentials/page.tsx',
  'server/src/app/msp/credentials/audit/page.tsx',
  'server/src/lib/initializeApp.ts',

  // Client merge: edition-optional table list (skipped when the table is absent in CE).
  'packages/clients/src/lib/clientMergePlan.ts',
  'packages/clients/src/lib/clientMergeEngine.test.ts',

  // Behavioral test for an EE-only portable vault implementation. The test
  // runs in the shared server unit suite but does not make this code reachable
  // from CE runtime source.
  'server/src/test/unit/product/coManagedPortableVault.test.ts',
  'server/src/test/unit/product/coManagedPortableWorkspaceRestoreVault.test.ts',
]);

// Shared lifecycle/admission catalogs describe the combined CE + EE schema.
// Exempt only their literal data declarations, never executable code in the file.
const METADATA_DECLARATIONS = new Map([
  ['packages/db/src/lib/tenantTableMetadata.ts', 'tenantTableMetadata'],
  ['packages/db/src/lib/tenantTableManifest.ts', 'TENANT_TABLE_MANIFEST'],
  ['packages/db/src/lib/tenantTableForeignKeys.ts', 'TENANT_TABLE_FOREIGN_KEYS'],
  ['packages/db/src/lib/operationalWriteTables.ts', 'OPERATIONAL_WRITE_TABLES'],
]);

const TABLES = 'credentials|credential_associations|credential_access_grants';
const KNEX_TABLE_METHODS =
  'createTable|createTableIfNotExists|dropTable|dropTableIfExists|alterTable|hasTable|hasColumn|table|from|into|join|leftJoin|rightJoin|innerJoin|scoped|unscoped|withSchema';

const VIOLATION_PATTERNS: Array<{ name: string; regex: RegExp; allowsMetadata?: boolean }> = [
  // Names unique to the vault are forbidden outside approved metadata declarations.
  { name: 'vault association/grant table', regex: /\b(?:credential_associations|credential_access_grants)\b/, allowsMetadata: true },
  // `credentials` is a common word: only match it in table-position contexts.
  {
    name: 'knex table method on credentials',
    regex: new RegExp(`\\.(?:${KNEX_TABLE_METHODS})\\(\\s*['"\`](?:${TABLES})['"\`]`),
  },
  {
    name: 'knex builder call on credentials',
    regex: /\b(?:db|knex|trx|tx|conn|connection|knexOrTrx|scopedDb)\(\s*['"`]credentials['"`]\s*\)/,
  },
  { name: 'table: credentials', regex: /\btable:\s*['"`]credentials['"`]/, allowsMetadata: true },
  {
    name: 'raw SQL on credentials',
    regex: /\b(?:from|join|into|update|table|exists)\s+(?:public\.)?"?credentials"?\s*(?:\w+\s+)?(?:where|on|set|values|cascade|\(|;|$)/m,
  },
  {
    name: 'EE credential module import',
    // Only import/require/dynamic-import specifiers, so prose mentioning the path in comments is fine.
    regex: /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bvi\.(?:mock|importActual)\s*\(\s*)['"`][^'"`]*(?:ee\/server\/src\/(?:lib|components)\/credentials|@enterprise\/[\w./-]*credentials)/,
  },
];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.sql']);

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((file) => SCANNED_EXTENSIONS.has(path.extname(file)));
}

function isAllowed(file: string): boolean {
  return ALLOWED_FILES.has(file) || ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function findViolations(file: string, source: string): string[] {
  if (isAllowed(file)) return [];
  const declaration = METADATA_DECLARATIONS.get(file);
  return VIOLATION_PATTERNS.flatMap(rule => findSourceBoundaryViolations(
    source,
    [rule],
    rule.allowsMetadata && declaration ? [declaration] : [],
  ).map(name => `${file}: ${name}`));
}

describe('credentials boundary validation', () => {
  const manifest = 'packages/db/src/lib/tenantTableManifest.ts';

  it.each([
    [manifest, "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials', deletion: 'ordered' }, { table: 'credential_associations', deletion: 'ordered' }] as const;"],
    ['packages/db/src/lib/tenantTableForeignKeys.ts', "export const TENANT_TABLE_FOREIGN_KEYS = [{ child: 'credential_access_grants', parent: 'credentials', deleteRule: 'CASCADE' }];"],
    ['packages/db/src/lib/operationalWriteTables.ts', "export const OPERATIONAL_WRITE_TABLES = { credential_associations: { reason: 'credential associations' } } satisfies Record<string, { reason: string }>;"],
  ])('accepts declarative shared metadata in %s', (file, source) => {
    expect(findViolations(file, source)).toEqual([]);
  });

  it('rejects executable vault access alongside a metadata declaration', () => {
    const source = `
      export const TENANT_TABLE_MANIFEST = [{ table: 'credentials' }];
      export function readVault(db) { return db('credentials').select('*'); }
    `;
    expect(findViolations(manifest, source)).toContain(`${manifest}: knex builder call on credentials`);
  });

  it.each([
    "[{ table: 'credentials', rows: db('credentials').select('*') }]",
    "[{ get table() { return 'credential_associations'; } }]",
    "[{ [db('credentials')]: 'credential_associations' }]",
    "[{ ...db('credentials'), table: 'credentials' }]",
    "[{ table: `credential_associations${db('credentials')}` }]",
    "loadMetadata('credential_associations')",
  ])('rejects executable metadata initializers: %s', (initializer) => {
    expect(findViolations(manifest, `export const TENANT_TABLE_MANIFEST = ${initializer};`)).not.toEqual([]);
  });

  it('rejects an unrelated declaration in a shared metadata file', () => {
    expect(findViolations(manifest, "export const OTHER_TABLES = [{ table: 'credentials' }];")).not.toEqual([]);
  });

  it('checks other variables declared alongside metadata', () => {
    const source = "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials' }], rows = db('credentials').select('*');";
    expect(findViolations(manifest, source)).toContain(`${manifest}: knex builder call on credentials`);
  });

  it('does not exempt mutable metadata declarations', () => {
    expect(findViolations(manifest, "export let TENANT_TABLE_MANIFEST = [{ table: 'credentials' }];")).not.toEqual([]);
  });

  it('rejects metadata-shaped vault access outside the shared catalogs', () => {
    expect(findViolations('packages/clients/src/vault.ts', "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials' }];")).not.toEqual([]);
  });

  it('rejects EE credential module imports in shared metadata files', () => {
    expect(findViolations(manifest, "import { readVault } from '@enterprise/lib/credentials/actions';"))
      .toContain(`${manifest}: EE credential module import`);
  });
});

describe('credentials boundary validation from main', () => {
  const manifest = 'packages/db/src/lib/tenantTableManifest.ts';
  const data = "[{ table: 'credentials', deletion: 'ordered' }, { table: 'credential_associations', deletion: 'ordered' }]";

  it.each([...METADATA_DECLARATIONS])('accepts literal schema metadata in %s', (file, name) => {
    expect(findViolations(file, `export const ${name} = ${data} as const;`)).toEqual([]);
  });

  it('rejects the same data outside its designated declaration or file', () => {
    expect(findViolations(manifest, `const OTHER = ${data};`)).not.toEqual([]);
    expect(findViolations('packages/db/src/lib/other.ts', `const TENANT_TABLE_MANIFEST = ${data};`)).not.toEqual([]);
    expect(findViolations(manifest, `let TENANT_TABLE_MANIFEST = ${data};`)).not.toEqual([]);
  });

  it.each([
    "db('credentials').select('*');",
    "db.from('credential_associations').delete();",
    "db.raw('delete from credentials where tenant = ?');",
    "import vault from '@enterprise/lib/credentials/service';",
  ])('rejects runtime vault access alongside metadata: %s', operation => {
    expect(findViolations(manifest, `const TENANT_TABLE_MANIFEST = ${data};\n${operation}`)).not.toEqual([]);
  });

  it.each([
    "[{ table: 'credentials', value: db('credentials') }]",
    "[{ table: 'credentials', get value() { return db('credentials'); } }]",
    "[{ table: 'credentials', ...extra }]",
    "[{ table: 'credentials', value: importedData }]",
    "[{ table: 'credentials', [computeKey()]: true }]",
  ])('rejects executable or indirect metadata: %s', initializer => {
    expect(findViolations(manifest, `const TENANT_TABLE_MANIFEST = ${initializer};`)).not.toEqual([]);
  });

  it('still detects raw SQL embedded in literal metadata', () => {
    expect(findViolations(manifest, `const TENANT_TABLE_MANIFEST = [{ note: 'delete from credentials where tenant = ?' }];`)).not.toEqual([]);
    expect(findViolations(manifest, `export const TENANT_TABLE_MANIFEST = [{ note: 'delete from credentials where tenant = ?' }];`)).not.toEqual([]);
  });

  it('permits unrelated authentication credentials and EE vault code', () => {
    expect(findViolations('packages/auth/src/oauth.ts', 'const credentials = provider.credentials;')).toEqual([]);
    expect(findViolations('ee/server/src/lib/credentials/service.ts', "db('credentials').select('*');")).toEqual([]);
  });
});

describe('credentials edition boundary', () => {
  it('keeps vault tables and EE credential modules out of CE source', () => {
    const violations: string[] = [];
    for (const file of trackedFiles()) {
      if (isAllowed(file)) continue;
      const abs = path.join(repoRoot, file);
      if (!fs.existsSync(abs)) continue; // deleted in working tree but not yet committed
      const source = fs.readFileSync(abs, 'utf8');
      violations.push(...findViolations(file, source));
    }
    expect(violations).toEqual([]);
  });

  it('every allowlisted explicit path exists', () => {
    const missing = [...ALLOWED_FILES, ...METADATA_DECLARATIONS.keys()]
      .filter((file) => !fs.existsSync(path.join(repoRoot, file)));
    expect(missing).toEqual([]);
  });

  it('has the five credential migrations only as no-op placeholders in CE and real files in EE', () => {
    const names = [
      '20260811100000_create_credentials_tables.cjs',
      '20260811110000_add_credential_permissions.cjs',
      '20260812100000_disable_rls_on_credential_tables.cjs',
      '20260812110000_expand_credential_associations_entity_types.cjs',
      '20260828120000_add_credential_audit_permission.cjs',
    ];
    for (const name of names) {
      const ce = fs.readFileSync(path.join(repoRoot, 'server/migrations', name), 'utf8');
      expect(ce).toContain('CE no-op placeholder');
      expect(ce).not.toMatch(/createTable|knex\./);
      expect(fs.existsSync(path.join(repoRoot, 'ee/server/migrations', name))).toBe(true);
    }
  });
});

describe('credentials boundary scanner metadata handling', () => {
  const catalogs = [...METADATA_DECLARATIONS];

  it.each(catalogs)('accepts literal catalog data in %s', (file, declaration) => {
    const source = `export const ${declaration} = [
      { table: 'credentials', deletion: 'ordered', clientKeyed: true },
      { child: 'credential_associations', parent: 'credentials' },
      { credential_access_grants: { reason: 'write policy' } },
    ] as const;`;
    expect(findViolations(file, source)).toEqual([]);
    expect(findViolations('packages/example/src/feature.ts', source)).not.toEqual([]);
  });

  const runtimeSources = [
    `knex('credentials').select('*')`,
    `db.table('credential_associations').delete()`,
    `knex.schema.createTable('credentials', () => {})`,
    `knex.raw('select * from credentials;')`,
    `import('@enterprise/lib/credentials/actions')`,
  ];

  it.each(catalogs)('rejects runtime vault access alongside metadata in %s', (file, declaration) => {
    for (const runtime of runtimeSources) {
      const source = `export const ${declaration} = [{ table: 'credentials' }]; ${runtime};`;
      expect(findViolations(file, source), runtime).not.toEqual([]);
    }
  });

  it.each(catalogs)('rejects executable catalog initializers in %s', (file, declaration) => {
    for (const initializer of [
      ...runtimeSources,
      `[{ table: 'credentials', rows: knex('credentials').select() }]`,
      `[{ table: 'credentials', ...loadMetadata() }]`,
      `[{ ['credential_associations']: loadMetadata() }]`,
      `[{ table: 'credentials', get rows() { return knex('credentials'); } }]`,
    ]) {
      expect(findViolations(file, `export const ${declaration} = ${initializer};`), initializer).not.toEqual([]);
    }
  });

  it.each(catalogs)('rejects vault metadata in other declarations in %s', (file) => {
    expect(findViolations(file, `export const OTHER_TABLES = [{ table: 'credentials' }];`)).not.toEqual([]);
  });
});

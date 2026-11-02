import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Credentials vault is an EE-only (Pro) feature. Its DB schema lives in
 * ee/server/migrations and its runtime code in ee/ + packages/ee. This guard
 * fails if other tracked source accesses the credentials vault tables or
 * imports EE credential modules. Shared catalogs may declare literal metadata
 * for both editions; executable code in those files is still checked.
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

  // Shared metadata / RBAC catalog (data, not logic).
  'packages/db/src/lib/tenantTableMetadata.ts',
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
]);

const TABLES = 'credentials|credential_associations|credential_access_grants';
const KNEX_TABLE_METHODS =
  'createTable|createTableIfNotExists|dropTable|dropTableIfExists|alterTable|hasTable|hasColumn|table|from|into|join|leftJoin|rightJoin|innerJoin|scoped|unscoped|withSchema';

const VIOLATION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // Names unique to the vault: any mention in code is a violation.
  { name: 'vault association/grant table', regex: /\b(?:credential_associations|credential_access_grants)\b/ },
  // `credentials` is a common word: only match it in table-position contexts.
  {
    name: 'knex table method on credentials',
    regex: new RegExp(`\\.(?:${KNEX_TABLE_METHODS})\\(\\s*['"\`](?:${TABLES})['"\`]`),
  },
  {
    name: 'knex builder call on credentials',
    regex: /\b(?:db|knex|trx|tx|conn|connection|knexOrTrx|scopedDb)\(\s*['"`]credentials['"`]\s*\)/,
  },
  { name: 'table: credentials', regex: /\btable:\s*['"`]credentials['"`]/ },
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

const SHARED_METADATA_DECLARATIONS: Readonly<Record<string, string>> = {
  'packages/db/src/lib/operationalWriteTables.ts': 'OPERATIONAL_WRITE_TABLES',
  'packages/db/src/lib/tenantTableForeignKeys.ts': 'TENANT_TABLE_FOREIGN_KEYS',
  'packages/db/src/lib/tenantTableManifest.ts': 'TENANT_TABLE_MANIFEST',
};

function isLiteralMetadata(node: ts.Expression): boolean {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return isLiteralMetadata(node.expression);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(isLiteralMetadata);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) =>
      ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name)
      && isLiteralMetadata(property.initializer));
  }
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

function executableSource(file: string, source: string): string {
  const declarationName = SHARED_METADATA_DECLARATIONS[file];
  if (!declarationName) return source;

  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let executable = source;
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)
      || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== declarationName
        || !declaration.initializer || !isLiteralMetadata(declaration.initializer)) continue;
      // Mask only the proven data expression, never the rest of its file.
      const start = declaration.initializer.getStart(parsed);
      const end = declaration.initializer.getEnd();
      executable = executable.slice(0, start) + ' '.repeat(end - start) + executable.slice(end);
    }
  }
  return executable;
}

function findViolations(file: string, source: string): string[] {
  const executable = executableSource(file, source);
  return VIOLATION_PATTERNS
    .filter(({ regex }) => regex.test(executable))
    .map(({ name }) => `${file}: ${name}`);
}

describe('credentials boundary validation', () => {
  const manifestFile = 'packages/db/src/lib/tenantTableManifest.ts';

  it.each([
    [manifestFile, "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials', deletion: 'ordered' }, { table: 'credential_associations', deletion: 'ordered' }] as const;"],
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
    expect(findViolations(manifestFile, source)).toEqual([
      `${manifestFile}: knex builder call on credentials`,
    ]);
  });

  it.each([
    "[{ table: 'credentials', rows: db('credentials').select('*') }]",
    "[{ get table() { return 'credential_associations'; } }]",
    "[{ [db('credentials')]: 'credential_associations' }]",
    "[{ ...db('credentials'), table: 'credentials' }]",
    "[{ table: `credential_associations${db('credentials')}` }]",
    "loadMetadata('credential_associations')",
  ])('rejects executable metadata initializers: %s', (initializer) => {
    expect(findViolations(manifestFile, `export const TENANT_TABLE_MANIFEST = ${initializer};`))
      .not.toEqual([]);
  });

  it('rejects an unrelated declaration in a shared metadata file', () => {
    expect(findViolations(manifestFile, "export const OTHER_TABLES = [{ table: 'credentials' }];"))
      .not.toEqual([]);
  });

  it('checks other variables declared alongside metadata', () => {
    const source = "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials' }], rows = db('credentials').select('*');";
    expect(findViolations(manifestFile, source))
      .toEqual([`${manifestFile}: knex builder call on credentials`]);
  });

  it('does not exempt mutable metadata declarations', () => {
    expect(findViolations(manifestFile, "export let TENANT_TABLE_MANIFEST = [{ table: 'credentials' }];"))
      .not.toEqual([]);
  });

  it('rejects metadata-shaped vault access outside the shared catalogs', () => {
    expect(findViolations('packages/clients/src/vault.ts', "export const TENANT_TABLE_MANIFEST = [{ table: 'credentials' }];"))
      .not.toEqual([]);
  });

  it('rejects EE credential module imports in shared metadata files', () => {
    expect(findViolations(manifestFile, "import { readVault } from '@enterprise/lib/credentials/actions';"))
      .toEqual([`${manifestFile}: EE credential module import`]);
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
    const missing = [...ALLOWED_FILES].filter((file) => !fs.existsSync(path.join(repoRoot, file)));
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

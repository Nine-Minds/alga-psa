import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

// Only these declarations may contain vault metadata. The rest of each file
// remains subject to every boundary rule, including imports and DB calls.
const METADATA_DECLARATIONS: Readonly<Record<string, string>> = {
  'packages/db/src/lib/operationalWriteTables.ts': 'OPERATIONAL_WRITE_TABLES',
  'packages/db/src/lib/tenantTableForeignKeys.ts': 'TENANT_TABLE_FOREIGN_KEYS',
  'packages/db/src/lib/tenantTableManifest.ts': 'TENANT_TABLE_MANIFEST',
};

function isLiteralData(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isLiteralData);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
      && isLiteralData(property.initializer));
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return isLiteralData(node.expression);
  }
  return false;
}

function boundaryViolations(file: string, source: string): string[] {
  const declaration = METADATA_DECLARATIONS[file];
  if (declaration) {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of parsed.statements) {
      if (!ts.isVariableStatement(statement)
        || !(statement.declarationList.flags & ts.NodeFlags.Const)
        || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const variable of statement.declarationList.declarations) {
        if (ts.isIdentifier(variable.name) && variable.name.text === declaration
          && variable.initializer && isLiteralData(variable.initializer)) {
          // Preserve offsets if a statement declares more than one variable.
          const start = variable.initializer.getStart(parsed);
          const end = variable.initializer.end;
          source = source.slice(0, start) + ' '.repeat(end - start) + source.slice(end);
        }
      }
    }
  }
  return VIOLATION_PATTERNS.filter(({ regex }) => regex.test(source)).map(({ name }) => `${file}: ${name}`);
}

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


describe('credentials edition boundary', () => {
  it('keeps vault tables and EE credential modules out of CE source', () => {
    const violations: string[] = [];
    for (const file of trackedFiles()) {
      if (isAllowed(file)) continue;
      const abs = path.join(repoRoot, file);
      if (!fs.existsSync(abs)) continue; // deleted in working tree but not yet committed
      const source = fs.readFileSync(abs, 'utf8');
      violations.push(...boundaryViolations(file, source));
    }
    expect(violations).toEqual([]);
  });

  it('every allowlisted explicit path exists', () => {
    const missing = [...ALLOWED_FILES, ...Object.keys(METADATA_DECLARATIONS)]
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
  const catalogs = Object.entries(METADATA_DECLARATIONS);

  it.each(catalogs)('accepts literal catalog data in %s', (file, declaration) => {
    const source = `export const ${declaration} = [
      { table: 'credentials', deletion: 'ordered', clientKeyed: true },
      { child: 'credential_associations', parent: 'credentials' },
      { credential_access_grants: { reason: 'write policy' } },
    ] as const;`;
    expect(boundaryViolations(file, source)).toEqual([]);
    expect(boundaryViolations('packages/example/src/feature.ts', source)).not.toEqual([]);
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
      expect(boundaryViolations(file, source), runtime).not.toEqual([]);
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
      expect(boundaryViolations(file, `export const ${declaration} = ${initializer};`), initializer).not.toEqual([]);
    }
  });

  it.each(catalogs)('rejects vault metadata in other declarations in %s', (file) => {
    expect(boundaryViolations(file, `export const OTHER_TABLES = [{ table: 'credentials' }];`)).not.toEqual([]);
  });
});

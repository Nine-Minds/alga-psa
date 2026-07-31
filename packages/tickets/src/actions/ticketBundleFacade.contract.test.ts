// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const source = readRepoFile('packages/tickets/src/actions/ticketBundleActions.ts');
const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'clients',
  'statuses',
  'ticket_bundle_settings',
  'tickets',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket bundle facade contract', () => {
  it('registers every tenant table used by the migrated bundle roots', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated bundle action roots behind tenantDb', () => {
    expect(source).toContain('tenantDb');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
    expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
    expect(source).not.toMatch(/\.(?:where|andWhere)\(\s*['"](?:tenant|[^'"]+\.tenant)['"]/);
    expect(source).not.toMatch(/\.andOn\([^)\n]*tenant/);

    for (const table of coveredTenantTables) {
      expect(source).not.toMatch(directRootPattern(table));
    }
  });

  it('uses facade joins for eligible child ticket search', () => {
    expect(source).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(source).toContain("tenantJoin(");
    expect(source).toContain("'statuses as s'");
    expect(source).toContain("'clients as c'");
    expect(source).not.toContain("'tickets.tenant': tenant");
  });
});

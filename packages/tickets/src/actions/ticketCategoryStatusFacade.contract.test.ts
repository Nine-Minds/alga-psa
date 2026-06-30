// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const sources = {
  categoryActions: readRepoFile('packages/tickets/src/actions/ticketCategoryActions.ts'),
  boardTicketStatusActions: readRepoFile('packages/tickets/src/actions/board-actions/boardTicketStatusActions.ts'),
};

const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'boards',
  'categories',
  'statuses',
  'tickets',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket category/status facade contract', () => {
  it('registers every tenant table used by migrated category/status roots', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated category/status roots behind tenantDb', () => {
    for (const source of Object.values(sources)) {
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.(?:where|andWhere)\(\s*['"](?:tenant|[^'"]+\.tenant)['"]/);
      expect(source).not.toMatch(/\.andOn\([^)\n]*tenant/);

      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
    }
  });

  it('keeps status column metadata explicitly marked as non-row data', () => {
    expect(sources.boardTicketStatusActions).toContain(
      ".unscoped('statuses', 'columnInfo reads schema metadata, not tenant rows')"
    );
    expect(sources.boardTicketStatusActions).toContain('columnInfo()');
  });
});

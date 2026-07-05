// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const sources = {
  board: readRepoFile('packages/tickets/src/models/board.ts'),
  priority: readRepoFile('packages/tickets/src/models/priority.ts'),
  status: readRepoFile('packages/tickets/src/models/status.ts'),
  ticket: readRepoFile('packages/tickets/src/models/ticket.ts'),
};

const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'boards',
  'priorities',
  'statuses',
  'tickets',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|knexOrTrx|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket model facade contract', () => {
  it('registers every tenant table used by migrated ticket models', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated ticket model roots behind tenantDb', () => {
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

  it('uses facade joins for ticket model tenant-table joins', () => {
    expect(sources.ticket).toContain("tenantJoin(");
    expect(sources.ticket).toContain("'priorities'");
    expect(sources.ticket).toContain("'statuses'");
  });
});

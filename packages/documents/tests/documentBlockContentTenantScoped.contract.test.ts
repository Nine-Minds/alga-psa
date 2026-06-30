import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentBlockContentActions.ts'), 'utf8');

describe('document block-content tenant-scoped query contract', () => {
  it('uses structural tenant scoping for block content, document, and user roots', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(knex, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'document_block_content', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(source).not.toContain("knex('users')");
    expect(source).not.toContain("trx('document_block_content')\n        .where");
    expect(source).not.toContain("trx('documents')\n          .where");
    expect(source).not.toContain('.where({ user_id: input.user_id, tenant })');
    expect(source).not.toContain('.where({ user_id: input.user_id || user.user_id, tenant })');
    expect(source).not.toContain('document_id: documentId,\n          tenant');
  });
});

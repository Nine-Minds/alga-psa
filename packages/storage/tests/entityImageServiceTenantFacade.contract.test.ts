import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/entityImageService.ts'),
  'utf8',
);

describe('entity image service tenant facade migration contract', () => {
  it('uses tenantDb for tenant-owned document image roots', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain("tenantScopedTable(trx, 'document_folders', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'document_types', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'document_associations', tenant)");
    expect(source).toContain("knexOrTrx('shared_document_types')");
    expect(source).not.toContain("trx('document_folders')");
    expect(source).not.toContain("knex('documents')");
    expect(source).not.toContain("trx('document_associations')");
  });
});

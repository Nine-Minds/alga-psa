import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/lib/shareLinkPublic.ts'), 'utf8');

describe('public share-link tenant-scoped query contract', () => {
  it('uses structural tenant scoping after token discovery reveals tenant', () => {
    expect(source).toContain("import { createTenantScopedQuery, getConnection } from '@alga-psa/db'");
    expect(source).toContain("knex('document_share_links as sl')");
    expect(source).toContain("table: 'document_share_links'");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".where('tenant', tenant)");
  });
});

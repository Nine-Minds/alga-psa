import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const countEnrichmentSection = source.slice(
  source.indexOf('async function enrichFolderTreeWithCounts(')
);

describe('document folder count enrichment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for count-enrichment document and association roots', () => {
    expect(countEnrichmentSection).toContain("tenantScopedTable(knex, 'documents as d', tenant)");
    expect(countEnrichmentSection).toContain("tenantScopedTable(knex, 'document_associations as da', tenant)");
    expect(countEnrichmentSection).toContain("tenantScopedTable(knex, 'document_associations as filter_da', tenant)");
    expect(countEnrichmentSection).not.toContain("knex('documents as d')");
    expect(countEnrichmentSection).not.toContain(".from('document_associations as da')");
    expect(countEnrichmentSection).not.toContain(".from('document_associations as filter_da')");
    expect(countEnrichmentSection).not.toContain(".where('d.tenant', tenant)");
    expect(countEnrichmentSection).not.toContain(".andWhere('da.tenant', tenant)");
    expect(countEnrichmentSection).not.toContain(".andWhere('filter_da.tenant', tenant)");
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = [
  'defaultFolderActions.ts',
  'documentContentActions.ts',
  'shareLinkActions.ts',
  '../lib/shareLinkPublic.ts',
];

const sources = files.map((file) => ({
  file,
  source: readFileSync(resolve(__dirname, file), 'utf8'),
}));

describe('small document actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for default folders, content, and tenant-known share links', () => {
    const combined = sources.map(({ source }) => source).join('\n');

    expect(combined).toContain("tenantDb(knex, tenant).table('document_default_folders')");
    expect(combined).toMatch(/tenantDb\(trx, tenant\)\.table(?:<[^>]+>)?\('document_content'\)/);
    expect(combined).toContain("tenantDb(knex, tenant).table('documents')");
    expect(combined).toContain("tenantDb(knex, tenant).table('document_share_links')");
    expect(combined).toContain("tenantDb(knex, tenant).table('document_share_links').insert");
    expect(combined).toContain("tenantDb(trx, tenant).table('document_default_folders').insert");
    expect(combined).toContain(".unscoped('document_share_links as sl', SHARE_TOKEN_DISCOVERY_REASON)");
    expect(combined).toContain("tenantDb(knex, tenant).table('document_share_access_log').insert");
    expect(combined).not.toContain('createTenantScopedQuery');
    expect(combined).not.toContain("knex('document_share_links as sl')");
    expect(combined).not.toContain("knex('document_share_access_log').insert");

    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/\b(?:knex|trx)\('(document_default_folders|document_content|documents|document_share_links)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
      expect(source, file).not.toMatch(/\b(?:knex|trx)\('(document_default_folders|document_content|documents|document_share_links)'\)\.where\(\{[^}]*tenant/);
      expect(source, file).not.toMatch(/\.andWhere\('tenant', tenant\)/);
      expect(source, file).not.toMatch(/\.where\('tenant', tenant\)/);
    }
  });
});

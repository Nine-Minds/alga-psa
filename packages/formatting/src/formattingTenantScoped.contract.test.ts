import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const imageUrlSource = readFileSync(resolve(__dirname, 'imageUrl.ts'), 'utf8');
const avatarUtilsSource = readFileSync(resolve(__dirname, 'avatarUtils.ts'), 'utf8');

describe('formatting tenant-scoped query contract', () => {
  it('uses structural tenant scoping for image file roots', () => {
    expect(imageUrlSource).toContain('createTenantScopedQuery(trx, {');
    expect(imageUrlSource).toContain('createTenantScopedQuery(knex, {');
    expect(imageUrlSource).toContain("table: 'external_files'");
    expect(imageUrlSource).toContain('createTenantKnex(tenantId)');
    expect(imageUrlSource).toContain('getImageUrlCore(file_id, false, tenant)');

    expect(imageUrlSource).not.toContain(".where({ file_id, tenant })");
  });

  it('uses structural tenant scoping for avatar association and document roots', () => {
    expect(avatarUtilsSource).toContain('createTenantScopedQuery(trx, {');
    expect(avatarUtilsSource).toContain('createTenantScopedQuery(knex, {');
    expect(avatarUtilsSource).toContain("tenantScopedTable('document_associations')");
    expect(avatarUtilsSource).toContain("tenantScopedTable('documents')");

    expect(avatarUtilsSource).not.toContain("trx('document_associations')");
    expect(avatarUtilsSource).not.toContain("knex('document_associations')");
    expect(avatarUtilsSource).not.toContain("trx('documents')");
    expect(avatarUtilsSource).not.toContain("knex('documents')");
    expect(avatarUtilsSource).not.toContain('.andWhere({ tenant })');
  });
});

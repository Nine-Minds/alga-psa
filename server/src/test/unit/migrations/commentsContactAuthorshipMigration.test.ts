import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('comments contact authorship migration', () => {
  const migration = readRepoFile('server/migrations/20260211190000_add_comments_contact_id.cjs');

  it('T001: creates comments.contact_id as nullable UUID', () => {
    expect(migration).toContain("table.uuid('contact_id').nullable()");
  });

  it('T002: adds tenant-scoped FK and index for comments.contact_id', () => {
    expect(migration).toContain("table.index(['tenant', 'contact_id'], 'comments_tenant_contact_id_idx')");
    expect(migration).toContain(".foreign(['tenant', 'contact_id'], 'comments_tenant_contact_id_fk')");
    expect(migration).toContain(".references(['tenant', 'contact_name_id'])");
    expect(migration).toContain(".inTable('contacts')");
  });

  it('T003: down migration removes contact_id constraints and column', () => {
    expect(migration).toContain("table.dropForeign(['tenant', 'contact_id'], 'comments_tenant_contact_id_fk')");
    expect(migration).toContain("table.dropIndex(['tenant', 'contact_id'], 'comments_tenant_contact_id_idx')");
    expect(migration).toContain("table.dropColumn('contact_id')");
  });
});

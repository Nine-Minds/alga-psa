import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('resources (tenant, user_id) dedupe migration', () => {
  const migration = readRepoFile('server/migrations/20260724120000_dedupe_and_unique_resources_user.cjs');

  it('keeps the row carrying a capacity, then the most recently updated one', () => {
    expect(migration).toContain('PARTITION BY tenant, user_id');
    expect(migration).toContain('CASE WHEN max_weekly_capacity IS NOT NULL THEN 0 ELSE 1 END');
    expect(migration).toContain('updated_at DESC NULLS LAST');
    expect(migration).toContain('ranked.rn > 1');
  });

  it('co-locates the delete per shard by matching on tenant as well as resource_id', () => {
    expect(migration).toContain('r.tenant = ranked.tenant');
    expect(migration).toContain('r.resource_id = ranked.resource_id');
  });

  it('creates a tenant-leading unique index only once no duplicates remain', () => {
    expect(migration).toContain('duplicate group(s) remain after dedupe; aborting before index creation');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS resources_tenant_user_unique');
    expect(migration).toContain('ON resources (tenant, user_id)');
  });

  it('drops the index on rollback', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS resources_tenant_user_unique');
  });
});

import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('time_entries audit migrations', () => {
  it('adds created_by and updated_by columns (migration)', () => {
    const migration = readRepoFile(
      'server/migrations/20260131120000_add_time_entries_actor_audit_columns.cjs'
    );

    expect(migration).toContain("alterTable('time_entries'");
    expect(migration).toContain("table.uuid('created_by')");
    expect(migration).toContain("table.uuid('updated_by')");
  });

  it('adds tenant-scoped foreign keys for created_by and updated_by (migration)', () => {
    const migration = readRepoFile(
      'server/migrations/20260131120500_add_time_entries_actor_audit_fks.cjs'
    );

    expect(migration).toContain(".foreign(['tenant', 'created_by'])");
    expect(migration).toContain(".references(['tenant', 'user_id'])");
    expect(migration).toContain(".foreign(['tenant', 'updated_by'])");
    expect(migration).toContain(".inTable('users')");
  });
});

import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('standard_statuses global migration', () => {
  const migration = readRepoFile('server/migrations/20260610150000_make_standard_statuses_global.cjs');

  it('recovers orphaned project status mappings without reading standard_statuses inside the distributed update', () => {
    expect(migration).toContain('async function recoverOrphanedProjectTaskMappings(knex)');
    expect(migration).toContain('UPDATE project_status_mappings');
    expect(migration).toContain('SET standard_status_id = CASE custom_name');
    expect(migration).toContain('AND NOT (standard_status_id = ANY(?::uuid[]))');
    expect(migration).toContain('AND custom_name = ANY(?::text[])');
    expect(migration).not.toContain('SET standard_status_id = ss.standard_status_id');
    expect(migration).not.toContain('SELECT 1 FROM standard_statuses e');
  });
});

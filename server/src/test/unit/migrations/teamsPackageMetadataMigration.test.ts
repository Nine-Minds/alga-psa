import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('teams package metadata migration', () => {
  const migration = readRepoFile('ee/server/migrations/20260307193000_add_teams_package_metadata.cjs');

  it('T139/T140: adds and removes Teams app/package metadata columns on the tenant integration record', () => {
    expect(migration).toContain("hasColumn('teams_integrations', 'app_id')");
    expect(migration).toContain("table.text('app_id')");
    expect(migration).toContain("hasColumn('teams_integrations', 'bot_id')");
    expect(migration).toContain("table.text('bot_id')");
    expect(migration).toContain("hasColumn('teams_integrations', 'package_metadata')");
    expect(migration).toContain("table.jsonb('package_metadata')");
    expect(migration).toContain("table.dropColumn('package_metadata')");
    expect(migration).toContain("table.dropColumn('bot_id')");
    expect(migration).toContain("table.dropColumn('app_id')");
  });
});

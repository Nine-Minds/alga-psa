import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra mapping/disconnect contract checks', () => {
  it('T026: unmap route deactivates/remaps mapping without touching sync run history tables', () => {
    const unmapRoute = readRepoFile('ee/server/src/app/api/integrations/entra/mappings/unmap/route.ts');

    expect(unmapRoute).toContain("mapping_state: 'unmapped'");
    expect(unmapRoute).toContain('is_active: false');
    expect(unmapRoute).toContain("await knex('entra_client_tenant_mappings').insert");
    expect(unmapRoute).not.toContain('entra_sync_runs');
    expect(unmapRoute).not.toContain('entra_sync_run_tenants');
    expect(unmapRoute.toLowerCase()).not.toContain('delete from');
  });
});

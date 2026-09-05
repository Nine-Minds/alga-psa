import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('kb import staging tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

  it('includes the KB import staging table in the deletion order', () => {
    // kb_import_files.tenant -> tenants is NO ACTION, so rows left behind block
    // the final `tenants` delete outright. Omitting it also fails the
    // validate-tenant-management CI check.
    expect(source).toContain("'kb_import_files'");
  });

  it('keeps the tenant table registry in step with the deletion order', () => {
    // The two registries are maintained by hand and independently; a table in
    // one and not the other is how tenant deletion has broken before.
    const metadata = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');
    expect(metadata).toContain("kb_import_files: { scope: 'tenant' }");
  });
});

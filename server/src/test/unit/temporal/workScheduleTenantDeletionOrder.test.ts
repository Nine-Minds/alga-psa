import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('work schedule tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
  const usersIndex = source.indexOf("'users',      // Delete users LAST");

  it('deletes work schedules before users', () => {
    const scheduleIndex = source.indexOf("'user_work_schedules'");

    expect(scheduleIndex).toBeGreaterThan(-1);
    expect(usersIndex).toBeGreaterThan(-1);
    // The FK is ON DELETE CASCADE, but the tenant FK is NO ACTION: rows left
    // until the final `tenants` delete would block it, so the explicit delete
    // has to come first rather than riding the cascade.
    expect(scheduleIndex).toBeLessThan(usersIndex);
  });

  it('keeps the tenant table registry in step with the deletion order', () => {
    // The two registries are maintained by hand and independently. A table in
    // one and not the other is exactly how tenant deletion broke here.
    const metadata = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');
    expect(metadata).toContain("user_work_schedules: { scope: 'tenant' }");
  });
});

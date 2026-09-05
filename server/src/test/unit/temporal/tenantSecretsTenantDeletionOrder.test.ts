import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('tenant secrets tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

  it('deletes tenant secret metadata and audit history before users', () => {
    // tenant_secrets has composite FKs to users. Both tables have a tenant
    // column, so omitting either also fails validate-tenant-management CI.
    const auditIndex = source.indexOf("'tenant_secrets_audit_log'");
    const secretsIndex = source.indexOf("'tenant_secrets'");
    const usersIndex = source.indexOf("'users',");

    expect(auditIndex).toBeGreaterThanOrEqual(0);
    expect(secretsIndex).toBeGreaterThanOrEqual(0);
    expect(usersIndex).toBeGreaterThan(auditIndex);
    expect(usersIndex).toBeGreaterThan(secretsIndex);
  });

  it('keeps the tenant table registry in step with deletion', () => {
    const metadata = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');
    expect(metadata).toContain("tenant_secrets: { scope: 'tenant' }");
    expect(metadata).toContain("tenant_secrets_audit_log: { scope: 'tenant' }");
  });
});

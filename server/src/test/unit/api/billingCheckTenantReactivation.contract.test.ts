import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('billing check-tenant reactivation contract', () => {
  const sharedRoute = readRepoFile('server/src/app/api/billing/check-tenant/route.ts');
  const eeRoute = readRepoFile('ee/server/src/app/api/billing/check-tenant/route.ts');
  const ceRoute = readRepoFile('packages/ee/src/app/api/billing/check-tenant/route.ts');

  it('T006: EE check-tenant returns the additive pending-deletion fields for in-window deletions', () => {
    expect(eeRoute).toContain('getActivePendingDeletion(tenant.tenantId, knex)');
    expect(eeRoute).toContain('pendingDeletion: !!pendingDeletion');
    expect(eeRoute).toContain('reactivatable: !!pendingDeletion?.reactivatable');
    expect(eeRoute).toContain('deletionStatus: pendingDeletion?.status');
    expect(eeRoute).toContain('effectiveDeletionDate: pendingDeletion?.effectiveDeletionDate');
  });

  it('T007/T008: check-tenant keeps legacy existence behavior while adding false reactivation fields', () => {
    expect(ceRoute).toContain("knex('tenants')");
    expect(ceRoute).toContain("knex('users')");
    expect(ceRoute).toContain('exists: true');
    expect(ceRoute).toContain('tenantId: tenant.tenant');
    expect(ceRoute).toContain('tenantName: tenant.client_name');
    expect(ceRoute).toContain('pendingDeletion: false');
    expect(ceRoute).toContain('reactivatable: false');
    expect(ceRoute).toContain('exists: false');
    expect(ceRoute).toContain('{ status: 404 }');
  });

  it('T071: CE resolves to the no-table stub and EE owns the pending_tenant_deletions read at the same route path', () => {
    expect(sharedRoute.trim()).toBe(
      "export { dynamic, GET, runtime } from '@enterprise/app/api/billing/check-tenant/route';",
    );
    expect(ceRoute).not.toContain('pending_tenant_deletions');
    expect(eeRoute).toContain("from '@enterprise/lib/billing/tenantReactivationDetection'");
    expect(eeRoute).toContain('pendingDeletion: false');
  });
});

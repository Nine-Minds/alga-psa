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
    expect(eeRoute).toContain('getPendingDeletionSummary(tenant.tenantId, knex)');
    expect(eeRoute).toContain('pendingDeletion: !!pendingDeletion');
    expect(eeRoute).toContain('reactivatable: pendingDeletion?.reactivatable ?? false');
    expect(eeRoute).toContain('deletionStatus: pendingDeletion?.status');
    expect(eeRoute).toContain('effectiveDeletionDate: pendingDeletion?.effectiveDeletionDate');
  });

  it('T007/T008: check-tenant keeps legacy existence behavior while adding false reactivation fields', () => {
    // pre-tenant-context email discovery uses the deliberate unscoped escape hatch
    expect(ceRoute).toContain(
      ".unscoped('tenants', 'billing check discovers tenant by email before tenant context exists')",
    );
    expect(ceRoute).toContain(
      ".unscoped('users', 'billing check discovers internal admin by email before tenant context exists')",
    );
    // the follow-up tenants read is tenant-scoped through the facade
    expect(ceRoute).toContain('tenantDb(knex, adminUser.tenant)');
    expect(ceRoute).toContain(".table('tenants')");
    expect(ceRoute).toContain('exists: true');
    expect(ceRoute).toContain('tenantId: tenant.tenant');
    expect(ceRoute).toContain('tenantName: tenant.client_name');
    expect(ceRoute).toContain('pendingDeletion: false');
    expect(ceRoute).toContain('reactivatable: false');
    expect(ceRoute).toContain('exists: false');
    expect(ceRoute).toContain('{ status: 404 }');
  });

  it('T071: CE resolves to the no-table stub and EE owns the pending_tenant_deletions read at the same route path', () => {
    // The shim must export the handler DIRECTLY (delegating to EE), not re-export it:
    // Next's webpack production build doesn't register re-exported route handlers.
    expect(sharedRoute).toContain("from '@enterprise/app/api/billing/check-tenant/route'");
    expect(sharedRoute).toMatch(/export async function GET/);
    expect(sharedRoute).toContain("export const runtime = 'nodejs'");
    expect(sharedRoute).toContain("export const dynamic = 'force-dynamic'");
    expect(ceRoute).not.toContain('pending_tenant_deletions');
    expect(eeRoute).toContain("from '@enterprise/lib/billing/tenantReactivationDetection'");
    expect(eeRoute).toContain('pendingDeletion: false');
  });
});

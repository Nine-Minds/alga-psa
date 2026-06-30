import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = [
  'searchReconcileHandler.ts',
  'expiringCreditsNotificationHandler.ts',
  'expiredCreditsHandler.ts',
];

describe('credit and search job handlers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for selected job handler roots', () => {
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      if (file === 'searchReconcileHandler.ts') {
        expect(source).toContain(".unscoped<TenantRecord>('tenants', SEARCH_RECONCILE_TENANT_ENUMERATION_REASON)");
        expect(source).not.toContain("knex<TenantRecord>('tenants')");
      }
      expect(source).not.toContain(".where('tenant', tenant)");
      expect(source).not.toContain(".where('tenant', tenantId)");
      expect(source).not.toMatch(/\.where\(\{\s*tenant[\s,:}]/);
    }
  });
});

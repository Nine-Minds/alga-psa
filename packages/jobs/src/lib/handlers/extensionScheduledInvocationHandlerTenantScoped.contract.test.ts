import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'extensionScheduledInvocationHandler.ts'), 'utf8');

describe('extension scheduled invocation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant extension schedule and install roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("tenantColumn: 'tenant_id'");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_extension_schedule', tenantId)");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_extension_install', tenantId)");
    expect(source).not.toContain('tenant_id: tenantId, install_id: installId');
    expect(source).not.toContain('id: installId, tenant_id: tenantId');
    expect(source).not.toContain('id: scheduleId, tenant_id: tenantId');
  });
});

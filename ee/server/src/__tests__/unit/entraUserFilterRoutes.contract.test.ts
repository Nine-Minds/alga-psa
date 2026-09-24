import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routes = path.resolve(here, '../../app/api/integrations/entra/filters');
const defaults = fs.readFileSync(path.join(routes, 'route.ts'), 'utf8');
const managed = fs.readFileSync(path.join(routes, '[managedTenantId]/route.ts'), 'utf8');

describe('Entra user filter route contract', () => {
  it('gates defaults reads and writes with Entra read/update access and tenant-scoped storage', () => {
    expect(defaults).toContain("requireEntraAccess('read')");
    expect(defaults).toContain("requireEntraAccess('update')");
    expect(defaults).toContain("where({ tenant: access.tenantId })");
    expect(defaults).toContain('validateEntraUserFilterConfig');
  });

  it('verifies managed-tenant ownership and scopes override CRUD to the active tenant', () => {
    expect(managed).toContain("requireEntraAccess('read')");
    expect(managed).toContain("requireEntraAccess('update')");
    expect(managed).toContain("where({ tenant: access.tenantId, managed_tenant_id: managedTenantId })");
    expect(managed).toContain("body.override === null");
    expect(managed).toContain("onConflict(['tenant', 'managed_tenant_id'])");
  });
});

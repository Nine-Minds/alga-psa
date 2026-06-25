import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'nextAuthOptions.ts'), 'utf8');

describe('nextAuthOptions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for subscription and client-contact roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("table: 'tenants'");
    expect(source).toContain("table: 'stripe_subscriptions'");
    expect(source).toContain("table: 'tenant_addons'");
    expect(source).toContain("table: 'contacts'");
    expect(source).not.toContain(".where('tenant', tenantId)");
    expect(source).not.toContain('.where({ tenant: tenantId })');
    expect(source).not.toMatch(/contact_name_id:\s*user\.contact_id,\s*tenant:\s*user\.tenant/);
  });
});

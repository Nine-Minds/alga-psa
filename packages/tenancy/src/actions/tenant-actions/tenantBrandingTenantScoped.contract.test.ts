import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = [
  'tenantBrandingActions.ts',
  'tenantLogoActions.ts',
  'getTenantBrandingByDomain.ts',
];

describe('tenant branding actions tenant-scoped query contract', () => {
  it('persists the optional client portal hero gradient mode with branding', () => {
    const source = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(source).toContain("export type PortalHeroGradient = 'primary-shades' | 'primary-secondary'");
    expect(source).toContain('portalHeroGradient: branding.portalHeroGradient');
  });

  it('uses structural tenant scoping for tenant settings branding roots', () => {
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('tenantDb');
      expect(source).toContain("table('tenant_settings')");
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toContain(".where({ tenant })");
      expect(source).not.toContain('.where({ tenant: tenantId })');
      expect(source).not.toContain("knex('tenant_settings')\n    .where");
    }
  });
});

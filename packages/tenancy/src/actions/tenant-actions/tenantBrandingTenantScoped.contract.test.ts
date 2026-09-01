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

  it('persists the optional dark logo and side panel style', () => {
    const source = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(source).toContain("export type PortalSidebarStyle = 'default' | 'primary' | 'secondary'");
    expect(source).toContain('logoDarkUrl,');
    expect(source).toContain('portalSidebarStyle,');
  });

  it('carries existing optional branding forward so a partial save cannot wipe it', () => {
    const source = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(source).toContain('branding.logoDarkUrl ?? existingSettings.branding?.logoDarkUrl');
    expect(source).toContain('branding.portalSidebarStyle ?? existingSettings.branding?.portalSidebarStyle');
    expect(source).toContain('branding.portalFollowsTheme ?? existingSettings.branding?.portalFollowsTheme');
  });

  it('persists the portal theme opt-in and feeds it to the style generator', () => {
    const source = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(source).toContain('portalFollowsTheme?: boolean');
    expect(source).toContain('portalFollowsTheme,');
  });

  it('writes each tenant logo variant to its own branding key', () => {
    const source = readFileSync(resolve(__dirname, 'tenantLogoActions.ts'), 'utf8');
    expect(source).toContain("variant === 'dark' ? 'logoDarkUrl' : 'logoUrl'");
    expect(source).toContain('[brandingLogoKey(logoVariant)]');
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

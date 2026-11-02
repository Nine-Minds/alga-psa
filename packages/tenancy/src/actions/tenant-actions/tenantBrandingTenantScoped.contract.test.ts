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
    expect(source).toContain("dark: 'logoDarkUrl'");
    expect(source).toContain("wide: 'logoWideUrl'");
    expect(source).toContain("'wide-dark': 'logoWideDarkUrl'");
    expect(source).toContain("favicon: 'faviconUrl'");
    expect(source).toContain('[brandingLogoKey(logoVariant)]');
  });

  it('carries the wide wordmark and favicon forward on a partial save', () => {
    const source = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(source).toContain('branding.logoWideUrl ?? existingSettings.branding?.logoWideUrl');
    expect(source).toContain('branding.logoWideDarkUrl ?? existingSettings.branding?.logoWideDarkUrl');
    expect(source).toContain('branding.faviconUrl ?? existingSettings.branding?.faviconUrl');
  });

  it('records which image each square mark is cut from, and never wipes it', () => {
    const logoSource = readFileSync(resolve(__dirname, 'tenantLogoActions.ts'), 'utf8');
    expect(logoSource).toContain("default: 'logoMarkSource'");
    expect(logoSource).toContain("dark: 'logoDarkMarkSource'");
    expect(logoSource).toContain("markSource.kind === 'square' ? markSource.documentId : undefined");

    const brandingSource = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    expect(brandingSource).toContain('const logoMarkSource = existingSettings.branding?.logoMarkSource');
    expect(brandingSource).toContain('const logoDarkMarkSource = existingSettings.branding?.logoDarkMarkSource');
  });

  it('keeps the mark provenance out of the branding both portals read', () => {
    const brandingSource = readFileSync(resolve(__dirname, 'tenantBrandingActions.ts'), 'utf8');
    // Both read paths — the authenticated one and the public by-id one — go
    // through the same strip, so the document id never reaches a browser.
    const stripped = brandingSource.match(/\.\.\.withoutMarkProvenance\(tenantSettings\.settings\.branding\)/g);
    expect(stripped).toHaveLength(2);
    expect(brandingSource).not.toContain('...tenantSettings.settings.branding,');
  });

  it('serves the logo slot details to internal users only', () => {
    const logoSource = readFileSync(resolve(__dirname, 'tenantLogoActions.ts'), 'utf8');
    const infoAction = logoSource.slice(logoSource.indexOf('export const getTenantLogoInfoAction'));
    expect(infoAction).toContain("Promise<TenantLogoInfo | null>");
    expect(infoAction.slice(0, infoAction.indexOf('getConnection'))).toContain("user.user_type !== 'internal'");
  });

  it('gates every logo mutator on settings:update before it writes branding', () => {
    const logoSource = readFileSync(resolve(__dirname, 'tenantLogoActions.ts'), 'utf8');
    expect(logoSource).toContain("hasPermission(user, 'settings', 'update', knex)");

    const mutators = ['uploadTenantLogo', 'recropTenantLogo', 'deleteTenantLogo', 'linkDocumentAsTenantLogo'];
    for (const mutator of mutators) {
      const start = logoSource.indexOf(`export const ${mutator}`);
      const body = logoSource.slice(start, logoSource.indexOf('\n});', start));
      expect(body).toContain('guardTenantLogoWrite(user, tenant, tenantId)');
      expect(body.indexOf('guardTenantLogoWrite(')).toBeLessThan(body.indexOf('writeBrandingLogoUrl('));
    }

    // Only the four guarded mutators may call the branding writer.
    const callers = logoSource.match(/await writeBrandingLogoUrl\(/g) ?? [];
    const guardedCallers = mutators.reduce((count, mutator) => {
      const start = logoSource.indexOf(`export const ${mutator}`);
      const body = logoSource.slice(start, logoSource.indexOf('\n});', start));
      return count + (body.match(/await writeBrandingLogoUrl\(/g) ?? []).length;
    }, 0);
    expect(callers).toHaveLength(guardedCallers);
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

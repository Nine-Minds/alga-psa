import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const LAYOUT = path.resolve(__dirname, '../../../app/layout.tsx');
const layout = fs.readFileSync(LAYOUT, 'utf8');

const PORTAL_SIDEBAR = path.resolve(
  __dirname,
  '../../../../../packages/client-portal/src/components/layout/ClientPortalSidebar.tsx',
);
const portalSidebar = fs.readFileSync(PORTAL_SIDEBAR, 'utf8');

describe('client portal theming contract', () => {
  it('treats portal pages and portal auth pages as client portal routes', () => {
    expect(layout).toContain("pathname.includes('/client-portal')");
    expect(layout).toContain("pathname.includes('/auth/client-portal')");
  });

  it('resolves the tenant theme pair for signed-out portal visitors by host', () => {
    // Portal sign-in and password-reset screens have no session, so the pair has
    // to come from the same vanity-domain lookup branding already uses.
    expect(layout).toContain('getTenantThemeByDomain(host)');
    expect(layout).toContain('data-theme-pair={theme.pairId}');
  });

  it('injects the custom pair CSS ahead of the branding accents', () => {
    expect(layout.indexOf('server-tenant-theme-styles')).toBeGreaterThan(-1);
    expect(layout.indexOf('server-tenant-theme-styles')).toBeLessThan(
      layout.indexOf('server-tenant-branding-styles'),
    );
  });

  it('keeps branding accents portal-only until an EE tenant opts into white-label', () => {
    expect(layout).toContain('if (!isClientPortal && tenant && isEnterprise && theme.mspWhiteLabel)');
  });

  it('gives the portal side panel the hook the tint CSS is scoped to', () => {
    expect(portalSidebar).toContain('data-automation-id="client-portal-sidebar"');
  });

  it('prefers the dark logo on the always-dark portal side panel', () => {
    expect(portalSidebar).toContain('logoDarkUrl');
  });

  it('swaps the logo per mode on the portal auth screens', () => {
    const signIn = fs.readFileSync(
      path.resolve(__dirname, '../../../../../packages/auth/src/components/ClientPortalSignIn.tsx'),
      'utf8',
    );
    expect(signIn).toContain('dark:hidden');
    expect(signIn).toContain('hidden dark:block');
    // Tenants without a dark variant keep the single-logo markup.
    expect(signIn).toContain('logoDarkUrl');
  });
});

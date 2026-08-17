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

const GLOBALS = path.resolve(__dirname, '../../../app/globals.css');
const globals = fs.readFileSync(GLOBALS, 'utf8');

const repoRoot = path.resolve(__dirname, '../../../../..');
const AUTH_SHELLS = [
  'packages/auth/src/components/ClientPortalSignIn.tsx',
  'packages/auth/src/components/MspSignIn.tsx',
  'packages/auth/src/components/PortalSwitchPrompt.tsx',
  'packages/client-portal/src/components/auth/ClientPortalTenantDiscovery.tsx',
  'server/src/app/auth/check-email/CheckEmailClient.tsx',
  'server/src/app/auth/client-portal/forgot-password/ClientPortalForgotPassword.tsx',
  'server/src/app/auth/msp/forgot-password/page.tsx',
  'server/src/app/auth/password-reset/confirmation/page.tsx',
  'server/src/app/auth/password-reset/set-new-password/SetNewPasswordClient.tsx',
];

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

  it('paints every auth shell from the pair tokens instead of literal palette colors', () => {
    // The sign-in, discovery, password-reset and portal-switch screens are the
    // first thing a portal user sees, so they have to follow the tenant pair.
    expect(globals).toContain('.auth-page-surface');
    expect(globals).toContain('rgb(var(--color-primary-500) / 0.16)');
    expect(globals).toContain('html[data-theme-pair="high-contrast"] .auth-page-surface');

    for (const relPath of AUTH_SHELLS) {
      const source = fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8');
      expect(source, relPath).toContain('auth-page-surface');
      expect(source, relPath).not.toMatch(/dark:(from|via|to)-(blue|indigo|purple)-9\d0/);
    }
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

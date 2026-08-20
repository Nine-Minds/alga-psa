import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveMspBranding } from '@/components/layout/mspBranding';

const SIDEBAR = path.resolve(__dirname, '../../../components/layout/Sidebar.tsx');
const sidebar = fs.readFileSync(SIDEBAR, 'utf8');

const MSP_LAYOUT = path.resolve(__dirname, '../../../app/msp/layout.tsx');
const mspLayout = fs.readFileSync(MSP_LAYOUT, 'utf8');

const DEFAULT_LAYOUT = path.resolve(__dirname, '../../../components/layout/DefaultLayout.tsx');
const defaultLayout = fs.readFileSync(DEFAULT_LAYOUT, 'utf8');

const ALGADESK_SHELL = path.resolve(__dirname, '../../../components/layout/AlgaDeskMspShell.tsx');
const algaDeskShell = fs.readFileSync(ALGADESK_SHELL, 'utf8');

describe('MSP sidebar branding', () => {
  it('uses a shared uploaded logo after MSP white-labeling is enabled', () => {
    expect(
      resolveMspBranding(
        { logoUrl: '/api/documents/view/logo', clientName: 'Emerald City IT' },
        { isEnterprise: true, mspWhiteLabel: true },
      ),
    ).toEqual({
      logoUrl: '/api/documents/view/logo',
      logoDarkUrl: null,
      displayName: 'Emerald City IT',
    });
  });

  it('keeps the dark variant for the always-dark rail', () => {
    expect(
      resolveMspBranding(
        { logoDarkUrl: '/api/documents/view/dark' },
        { isEnterprise: true, mspWhiteLabel: true },
      ),
    ).toEqual({ logoUrl: null, logoDarkUrl: '/api/documents/view/dark', displayName: null });
  });

  it('keeps the stock Alga mark without a logo or outside Enterprise', () => {
    expect(resolveMspBranding(
      { logoUrl: '/api/documents/view/portal-logo' },
      { isEnterprise: true, mspWhiteLabel: false },
    )).toBeNull();
    expect(resolveMspBranding(
      { clientName: 'Emerald City IT' },
      { isEnterprise: true, mspWhiteLabel: true },
    )).toBeNull();
    expect(resolveMspBranding(
      { logoUrl: '' },
      { isEnterprise: true, mspWhiteLabel: true },
    )).toBeNull();
    expect(resolveMspBranding(null, { isEnterprise: true, mspWhiteLabel: true })).toBeNull();
    expect(resolveMspBranding(
      { logoUrl: '/api/documents/view/logo' },
      { isEnterprise: false, mspWhiteLabel: true },
    )).toBeNull();
  });

  it('does not read portal branding for the rail until MSP white-labeling is enabled', () => {
    expect(mspLayout).toContain('getTenantThemeByTenantId(tenantId)');
    expect(mspLayout).toContain('tenantTheme?.mspWhiteLabel === true');
    expect(mspLayout).toContain('const tenantBranding = mspWhiteLabel && tenantId');
    expect(mspLayout).toContain('resolveMspBranding(tenantBranding, { isEnterprise, mspWhiteLabel })');
  });

  it('renders the tenant mark in place of the Alga avatar', () => {
    expect(sidebar).toContain('tenantLogoUrl');
    expect(sidebar).toContain('mspBranding.logoDarkUrl || mspBranding.logoUrl');
    // The stock avatar only paints when no tenant logo was resolved.
    const tenantBranch = sidebar.indexOf('src={tenantLogoUrl}');
    const algaBranch = sidebar.indexOf('/images/avatar-purple-background.png');
    expect(tenantBranch).toBeGreaterThan(-1);
    expect(tenantBranch).toBeLessThan(algaBranch);
    // Tenant logos are rarely square; cropping them into the circle looks wrong.
    expect(sidebar).toContain('object-contain');
  });

  it('falls back to the stock mark when a stored tenant logo no longer exists', () => {
    expect(sidebar).toContain('failedTenantLogoUrl !== tenantLogoUrl');
    expect(sidebar).toContain('onError={() => setFailedTenantLogoUrl(tenantLogoUrl)}');
    expect(sidebar).toContain('/images/avatar-purple-background.png');
  });

  it('anchors MSP shells to the viewport so the logo row cannot scroll out of view', () => {
    expect(defaultLayout).toContain('className="fixed inset-0 flex overflow-hidden app-shell-ground"');
    expect(algaDeskShell).toContain('className="fixed inset-0 flex overflow-hidden app-shell-ground"');
  });
});

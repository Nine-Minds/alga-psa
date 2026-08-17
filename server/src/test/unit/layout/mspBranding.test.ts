import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveMspBranding } from '@/components/layout/mspBranding';

const SIDEBAR = path.resolve(__dirname, '../../../components/layout/Sidebar.tsx');
const sidebar = fs.readFileSync(SIDEBAR, 'utf8');

const MSP_LAYOUT = path.resolve(__dirname, '../../../app/msp/layout.tsx');
const mspLayout = fs.readFileSync(MSP_LAYOUT, 'utf8');

describe('MSP sidebar branding', () => {
  it('uses an uploaded logo as soon as it exists, without a second switch', () => {
    expect(
      resolveMspBranding({ logoUrl: '/api/documents/view/logo', clientName: 'Emerald City IT' }, { isEnterprise: true }),
    ).toEqual({
      logoUrl: '/api/documents/view/logo',
      logoDarkUrl: null,
      displayName: 'Emerald City IT',
    });
  });

  it('keeps the dark variant for the always-dark rail', () => {
    expect(
      resolveMspBranding({ logoDarkUrl: '/api/documents/view/dark' }, { isEnterprise: true }),
    ).toEqual({ logoUrl: null, logoDarkUrl: '/api/documents/view/dark', displayName: null });
  });

  it('keeps the stock Alga mark without a logo or outside Enterprise', () => {
    expect(resolveMspBranding({ clientName: 'Emerald City IT' }, { isEnterprise: true })).toBeNull();
    expect(resolveMspBranding({ logoUrl: '' }, { isEnterprise: true })).toBeNull();
    expect(resolveMspBranding(null, { isEnterprise: true })).toBeNull();
    expect(resolveMspBranding({ logoUrl: '/api/documents/view/logo' }, { isEnterprise: false })).toBeNull();
  });

  it('resolves the rail logo from tenant branding, not from the color switch', () => {
    expect(mspLayout).toContain('resolveMspBranding(tenantBranding, { isEnterprise })');
    expect(mspLayout).not.toContain('mspWhiteLabel');
    // Community builds must not even read tenant branding for the shell.
    expect(mspLayout).toContain('isEnterprise && tenantId');
  });

  it('renders the tenant mark in place of the Alga avatar', () => {
    expect(sidebar).toContain('tenantLogoUrl');
    // The stock avatar only paints when no tenant logo was resolved.
    const tenantBranch = sidebar.indexOf('src={tenantLogoUrl}');
    const algaBranch = sidebar.indexOf('/images/avatar-purple-background.png');
    expect(tenantBranch).toBeGreaterThan(-1);
    expect(tenantBranch).toBeLessThan(algaBranch);
    // Tenant logos are rarely square; cropping them into the circle looks wrong.
    expect(sidebar).toContain('object-contain');
  });
});

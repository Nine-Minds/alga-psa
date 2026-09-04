import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isLightSurface,
  pickLogoForSurface,
  resolveMspBranding,
  surfaceLuminance,
} from '@/components/layout/mspBranding';
import { CUSTOM_THEME_PRESETS } from '@alga-psa/tenancy/lib/customTheme';

const SIDEBAR = path.resolve(__dirname, '../../../components/layout/Sidebar.tsx');
const sidebar = fs.readFileSync(SIDEBAR, 'utf8');

const MSP_LAYOUT = path.resolve(__dirname, '../../../app/msp/layout.tsx');
const mspLayout = fs.readFileSync(MSP_LAYOUT, 'utf8');

const CLIENT_PORTAL_LAYOUT = path.resolve(__dirname, '../../../app/client-portal/layout.tsx');
const clientPortalLayout = fs.readFileSync(CLIENT_PORTAL_LAYOUT, 'utf8');

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
      logoWideUrl: null,
      logoWideDarkUrl: null,
      displayName: 'Emerald City IT',
    });
  });

  it('carries the dark variant through for dark surfaces', () => {
    expect(
      resolveMspBranding(
        { logoDarkUrl: '/api/documents/view/dark' },
        { isEnterprise: true, mspWhiteLabel: true },
      ),
    ).toEqual({
      logoUrl: null,
      logoDarkUrl: '/api/documents/view/dark',
      logoWideUrl: null,
      logoWideDarkUrl: null,
      displayName: null,
    });
  });

  it('carries the wide wordmark, including its dark variant', () => {
    expect(
      resolveMspBranding(
        {
          logoUrl: '/api/documents/view/mark',
          logoWideUrl: '/api/documents/view/wide',
          logoWideDarkUrl: '/api/documents/view/wide-dark',
          clientName: 'Emerald City IT',
        },
        { isEnterprise: true, mspWhiteLabel: true },
      ),
    ).toEqual({
      logoUrl: '/api/documents/view/mark',
      logoDarkUrl: null,
      logoWideUrl: '/api/documents/view/wide',
      logoWideDarkUrl: '/api/documents/view/wide-dark',
      displayName: 'Emerald City IT',
    });
  });

  it('white-labels on a wide-only upload so the wordmark still reaches the rail', () => {
    expect(
      resolveMspBranding(
        { logoWideUrl: '/api/documents/view/wide' },
        { isEnterprise: true, mspWhiteLabel: true },
      ),
    ).toEqual({
      logoUrl: null,
      logoDarkUrl: null,
      logoWideUrl: '/api/documents/view/wide',
      logoWideDarkUrl: null,
      displayName: null,
    });
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
    expect(mspLayout).toContain('const tenantBranding = mspWhiteLabel');
    expect(mspLayout).toContain('resolveMspBranding(tenantBranding, { isEnterprise, mspWhiteLabel })');
  });

  it('renders the tenant mark in place of the Alga avatar', () => {
    expect(sidebar).toContain('tenantLogoUrl');
    expect(sidebar).toContain('pickLogoForSurface(mspBranding.logoUrl, mspBranding.logoDarkUrl, railIsLight)');
    // The stock avatar only paints when no tenant logo was resolved.
    const tenantBranch = sidebar.indexOf('src={tenantLogoUrl}');
    const algaBranch = sidebar.indexOf('/images/avatar-purple-background.png');
    expect(tenantBranch).toBeGreaterThan(-1);
    expect(tenantBranch).toBeLessThan(algaBranch);
    // Tenant logos are rarely square; cropping them into the circle looks wrong.
    expect(sidebar).toContain('object-contain');
  });

  it('reserves the wide wordmark for the expanded rail and drops the duplicate name', () => {
    expect(sidebar).toContain('pickLogoForSurface(mspBranding.logoWideUrl, mspBranding.logoWideDarkUrl, railIsLight)');
    // The collapsed 4rem rail has no room for a wordmark, so the square mark wins there.
    expect(sidebar).toContain('const showWideLogo = sidebarOpen && !!tenantWideLogoUrl');
    expect(sidebar).toContain('src={tenantWideLogoUrl}');
    // Natural width, no circular frame — and the name span lives in the other branch.
    expect(sidebar).toContain('h-8 w-auto max-w-full object-contain');
    const wideBranch = sidebar.indexOf('{showWideLogo && tenantWideLogoUrl ? (');
    const nameSpan = sidebar.indexOf('{brandDisplayName}</span>');
    expect(wideBranch).toBeGreaterThan(-1);
    expect(wideBranch).toBeLessThan(nameSpan);
    expect(sidebar).toContain('onError={() => setFailedWideLogoUrl(tenantWideLogoUrl)}');
  });

  it('attributes AlgaPSA in the version footer only while white-labeled', () => {
    expect(sidebar).toContain('const isWhiteLabeled = Boolean(tenantLogoUrl || tenantWideLogoUrl)');
    expect(sidebar).toContain('{isWhiteLabeled && (');
    expect(sidebar).toContain("t('sidebar.poweredBy', { defaultValue: 'Powered by' })} AlgaPSA");
    expect(sidebar).toContain('title={`Powered by AlgaPSA v${appVersion}`}');
    // The star button links to our repository, so it steps aside for tenant branding.
    expect(sidebar).toContain('{sidebarOpen && !isWhiteLabeled && <GitHubStarButton />}');
  });

  it('lets a tenant favicon override the stock one on both shells', () => {
    expect(mspLayout).toContain('metadata.icons = { icon: tenantBranding.faviconUrl }');
    expect(clientPortalLayout).toContain('metadata.icons = { icon: branding.faviconUrl }');
  });

  it('falls back to the stock mark when a stored tenant logo no longer exists', () => {
    expect(sidebar).toContain('failedTenantLogoUrl !== tenantLogoUrl');
    expect(sidebar).toContain('onError={() => setFailedTenantLogoUrl(tenantLogoUrl)}');
    expect(sidebar).toContain('/images/avatar-purple-background.png');
  });

  it('measures the rail instead of assuming it is dark', () => {
    expect(sidebar).toContain('const railIsLight = useRailIsLight(railRef)');
    expect(sidebar).toContain('window.getComputedStyle(rail)');
    expect(sidebar).toContain("styles.getPropertyValue('--color-sidebar-bg')");
    // A theme switch repaints the rail, so the reading has to be redone.
    expect(sidebar).toContain('new MutationObserver(read)');
    // Muted footer text and the mark's frame follow the same surface.
    expect(sidebar).not.toContain('text-gray-400');
    expect(sidebar).not.toContain('bg-white/5');
    expect(sidebar).toContain('text-sidebar-text/60 hover:text-sidebar-text');
    expect(sidebar).toContain('bg-sidebar-text/5');
  });

  it('anchors MSP shells to the viewport so the logo row cannot scroll out of view', () => {
    expect(defaultLayout).toContain('className="fixed inset-0 flex overflow-hidden app-shell-ground"');
    expect(algaDeskShell).toContain('className="fixed inset-0 flex overflow-hidden app-shell-ground"');
  });
});

describe('rail surface detection', () => {
  it('reads the colours a browser and our theme tokens actually hand back', () => {
    expect(surfaceLuminance('rgb(255, 255, 255)')).toBeCloseTo(1, 5);
    expect(surfaceLuminance('rgb(0, 0, 0)')).toBeCloseTo(0, 5);
    // The token form the theme CSS stores, and the hex the editor saves.
    expect(surfaceLuminance('12 17 29')).toBeCloseTo(surfaceLuminance('#0c111d') ?? -1, 5);
    // A see-through rail paints whatever is behind it, so it tells us nothing.
    expect(surfaceLuminance('rgba(255, 255, 255, 0)')).toBeNull();
    expect(surfaceLuminance('')).toBeNull();
    expect(surfaceLuminance('not-a-colour')).toBeNull();
  });

  it('calls every shipped sidebar background dark and a hand-picked pale one light', () => {
    for (const [pairId, pair] of Object.entries(CUSTOM_THEME_PRESETS)) {
      expect(isLightSurface(pair.light.sidebarBg), `${pairId} light`).toBe(false);
      expect(isLightSurface(pair.dark.sidebarBg), `${pairId} dark`).toBe(false);
    }
    // What a custom theme can do to the rail, which is the whole point.
    expect(isLightSurface('#f7f8fa')).toBe(true);
    expect(isLightSurface('rgb(247, 248, 250)')).toBe(true);
    // Unreadable colours keep the dark-rail default rather than guessing.
    expect(isLightSurface(null)).toBe(false);
  });

  it('flips the variant order once the rail turns light', () => {
    expect(pickLogoForSurface('/light', '/dark', false)).toBe('/dark');
    expect(pickLogoForSurface('/light', '/dark', true)).toBe('/light');
    // Either slot alone still renders on either surface.
    expect(pickLogoForSurface('/light', null, false)).toBe('/light');
    expect(pickLogoForSurface(null, '/dark', true)).toBe('/dark');
    expect(pickLogoForSurface('', '', true)).toBeNull();
    expect(pickLogoForSurface(undefined, undefined, false)).toBeNull();
  });
});

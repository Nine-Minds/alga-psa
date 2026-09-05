import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sidebarSource = fs.readFileSync(
  path.resolve(__dirname, './ClientPortalSidebar.tsx'),
  'utf8',
);

describe('ClientPortalSidebar persistence + skeleton contract', () => {
  it('uses the dedicated client-portal cookie key (not the MSP one)', () => {
    expect(sidebarSource).toContain('client_portal_sidebar_collapsed');
    // The MSP cookie key must not be reused, otherwise both portals fight for the
    // same preference and toggling one collapses the other.
    expect(sidebarSource).not.toMatch(/['"]sidebar_collapsed['"]/);
  });

  it('persists state via the shared cookie+localStorage helpers', () => {
    expect(sidebarSource).toContain("from '@alga-psa/ui/lib/cookies'");
    expect(sidebarSource).toContain('savePreference(');
    expect(sidebarSource).toContain('getPreferenceWithFallback(');
  });

  it('accepts an initialCollapsed prop so the server can set first paint', () => {
    expect(sidebarSource).toContain('initialCollapsed');
  });

  it('renders a skeleton placeholder while permissions are loading', () => {
    expect(sidebarSource).toContain('permissionsLoaded');
    expect(sidebarSource).toContain('Skeleton');
  });

  it('still exposes the request-services link', () => {
    expect(sidebarSource).toMatch(/['"]\/client-portal\/request-services['"]/);
  });

  it('wears the wide wordmark instead of repeating the company name', () => {
    // The panel colour is admin-configurable, so the variant follows the paint.
    expect(sidebarSource).toContain("useSurfaceIsLight(panelRef, '--color-sidebar-bg')");
    expect(sidebarSource).toContain(
      'pickLogoForSurface(branding?.logoWideUrl, branding?.logoWideDarkUrl, panelIsLight)',
    );
    // The 4rem collapsed panel has no room for a wordmark; the square mark wins.
    expect(sidebarSource).toContain('const showWideLogo = sidebarOpen && !!wideLogoUrl');
    // The name is inside the image, so neither the brand row nor the
    // organization row prints it a second time.
    const wideBranch = sidebarSource.indexOf('{showWideLogo && wideLogoUrl ? (');
    const nameSpan = sidebarSource.indexOf('{brandLabel}');
    expect(wideBranch).toBeGreaterThan(-1);
    expect(wideBranch).toBeLessThan(nameSpan);
    expect(sidebarSource).toContain('{sidebarOpen && !showWideLogo && branding?.clientName && (');
    expect(sidebarSource).toContain('onError={() => setFailedWideLogoUrl(wideLogoUrl)}');
    // Muted panel chrome has to survive a light side panel too.
    expect(sidebarSource).not.toContain('text-gray-400');
    expect(sidebarSource).not.toContain('bg-gray-700');
  });

  it('contains explicit AlgaDesk portal navigation gating', () => {
    expect(sidebarSource).toContain('const isAlgaDeskPortal = productCode === \'algadesk\'');
    expect(sidebarSource).toContain('/client-portal/knowledge-base');
    expect(sidebarSource).toContain('/client-portal/profile');
    expect(sidebarSource).toContain('!isAlgaDeskPortal && <ClientPortalExtensionsNav');
  });
});

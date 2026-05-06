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

  it('contains explicit Algadesk portal navigation gating', () => {
    expect(sidebarSource).toContain('const isAlgadeskPortal = productCode === \'algadesk\'');
    expect(sidebarSource).toContain('/client-portal/knowledge-base');
    expect(sidebarSource).toContain('/client-portal/profile');
    expect(sidebarSource).toContain('!isAlgadeskPortal && <ClientPortalExtensionsNav');
  });
});

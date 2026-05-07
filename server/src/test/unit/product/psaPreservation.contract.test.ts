import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../../..');

describe('PSA preservation contract', () => {
  it('keeps PSA branches for core MSP compositions', () => {
    const dashboard = readFileSync(join(repoRoot, 'server/src/app/msp/dashboard/page.tsx'), 'utf8');
    const settings = readFileSync(join(repoRoot, 'server/src/components/settings/SettingsPage.tsx'), 'utf8');
    const ticketsList = readFileSync(join(repoRoot, 'server/src/app/msp/tickets/page.tsx'), 'utf8');
    const ticketsDetail = readFileSync(join(repoRoot, 'server/src/app/msp/tickets/[id]/page.tsx'), 'utf8');
    const clientsDetail = readFileSync(join(repoRoot, 'server/src/app/msp/clients/[id]/page.tsx'), 'utf8');

    expect(dashboard).toContain("=== 'algadesk'");
    expect(settings).toContain("=== 'algadesk'");
    expect(ticketsList).toContain("=== 'algadesk'");
    expect(ticketsDetail).toContain("=== 'algadesk'");
    expect(clientsDetail).toContain("=== 'algadesk'");
  });

  it('keeps PSA branch for portal layout composition', () => {
    const portalLayout = readFileSync(join(repoRoot, 'packages/client-portal/src/components/layout/ClientPortalSidebar.tsx'), 'utf8');
    expect(portalLayout).toContain("productCode = 'psa'");
    expect(portalLayout).toContain("productCode === 'algadesk'");
  });
});

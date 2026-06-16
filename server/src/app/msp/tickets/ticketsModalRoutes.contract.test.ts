import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('tickets modal route infrastructure', () => {
  it('renders the tickets page and modal slot inside the shared tickets provider', () => {
    const layout = read('server/src/app/msp/tickets/layout.tsx');

    expect(layout).toContain('TicketsRouteProvider');
    expect(layout).toContain('{children}');
    expect(layout).toContain('{modal}');
  });

  it('keeps the default modal slot closed on normal tickets list loads', () => {
    const defaultSlot = read('server/src/app/msp/tickets/@modal/default.tsx');

    expect(defaultSlot).toContain('return null');
  });

  it('routes Import through plain and intercepted route entries', () => {
    const plainRoute = read('server/src/app/msp/tickets/import/page.tsx');
    const modalRoute = read('server/src/app/msp/tickets/@modal/(.)import/page.tsx');
    const routeClient = read('server/src/app/msp/tickets/_components/TicketImportDialogRouteClient.tsx');
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(plainRoute).toContain('closeMode="replace"');
    expect(modalRoute).toContain('closeMode="back"');
    expect(routeClient).toContain('TicketImportDialog');
    expect(routeClient).toContain('router.back()');
    expect(routeClient).toContain("router.replace('/msp/tickets')");
    expect(dashboard).toContain("router.push('/msp/tickets/import')");
    expect(dashboard).not.toContain("import TicketImportDialog from './TicketImportDialog'");
    expect(dashboard).not.toContain('<TicketImportDialog');
  });

  it('shares active filters and selected ticket ids through the route context', () => {
    const provider = read('packages/tickets/src/components/TicketsRouteProvider.tsx');
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(provider).toContain('filters: ITicketListFilters');
    expect(provider).toContain('selectedTicketIds: Set<string>');
    expect(provider).toContain('selectedTicketIdsArray');
    expect(dashboard).toContain('useTicketsRouteState()');
    expect(dashboard).toContain('setTicketsRouteFilters(exportFilters)');
    expect(dashboard).toContain('setSelectedTicketIds');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const quickViewActions = vi.hoisted(() => ({
  loadClient: vi.fn(async (clientId: string, projectId?: string) => ({ client_id: clientId, project_id: projectId })),
  updateClient: vi.fn(async (clientId: string, patch: object, projectId?: string) => ({ client_id: clientId, patch, project_id: projectId })),
  loadLocations: vi.fn(async (clientId: string, projectId?: string) => [{ client_id: clientId, project_id: projectId }]),
  updateLocation: vi.fn(async (clientId: string, locationId: string, patch: object, projectId?: string) => ({ clientId, locationId, patch, projectId })),
}));

vi.mock('@alga-psa/projects/actions', () => ({
  mutateProjectClientLocationQuickView: vi.fn(async () => undefined),
  getProjectClientQuickView: (...args: Parameters<typeof quickViewActions.loadClient>) => quickViewActions.loadClient(...args),
  updateProjectClientQuickView: (...args: Parameters<typeof quickViewActions.updateClient>) => quickViewActions.updateClient(...args),
  getProjectClientLocationsQuickView: (...args: Parameters<typeof quickViewActions.loadLocations>) => quickViewActions.loadLocations(...args),
  updateProjectClientLocationQuickView: (...args: Parameters<typeof quickViewActions.updateLocation>) => quickViewActions.updateLocation(...args),
}));
vi.mock('@alga-psa/billing/components/hour-blocks/HourBlocksSection', () => ({ default: () => null }));
vi.mock('@alga-psa/tickets/components/QuickAddTicket', () => ({ QuickAddTicket: () => null }));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({ getTicketFormOptions: vi.fn(async () => ({})) }));
vi.mock('../tickets/MspRecurringTickets', () => ({ MspRecurringTicketsClientSection: () => null }));
vi.mock('./MspClientTickets', () => ({ default: () => null }));
vi.mock('./MspContactTickets', () => ({ default: () => null }));
vi.mock('./useTicketDetailsDrawer', () => ({ useTicketDetailsDrawer: () => vi.fn() }));

const { AlgaDeskClientCrossFeatureProvider } = await import('./AlgaDeskClientCrossFeatureProvider');
const { useClientCrossFeature } = await import('@alga-psa/clients/context/ClientCrossFeatureContext');

function AlgaDeskQuickViewProbe() {
  const callbacks = useClientCrossFeature();
  return (
    <div>
      <button onClick={async () => {
        const client = await callbacks.loadClientQuickView?.('client-1');
        const saved = await callbacks.updateClientQuickView?.('client-1', { client_name: 'Updated' });
        const locations = await callbacks.loadClientQuickViewLocations?.('client-1');
        const locationSave = await callbacks.updateClientQuickViewLocation?.('client-1', 'location-1', { location_name: 'HQ' });
        document.querySelector('[data-results]')!.textContent = JSON.stringify({ client, saved, locations, locationSave });
      }}>Exercise AlgaDesk client quick view</button>
      <output data-results />
    </div>
  );
}

describe('AlgaDeskClientCrossFeatureProvider quick-view callbacks', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('provides the same permission-safe load, save, and location boundaries as other MSP hosts', async () => {
    render(<AlgaDeskClientCrossFeatureProvider><AlgaDeskQuickViewProbe /></AlgaDeskClientCrossFeatureProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Exercise AlgaDesk client quick view' }));
    const output = await screen.findByText(/locationSave/);
    expect(output.textContent).toContain('client-1');
    expect(quickViewActions.loadClient).toHaveBeenCalledWith('client-1');
    expect(quickViewActions.updateClient).toHaveBeenCalledWith('client-1', { client_name: 'Updated' });
    expect(quickViewActions.loadLocations).toHaveBeenCalledWith('client-1');
    expect(quickViewActions.updateLocation).toHaveBeenCalledWith('client-1', 'location-1', { location_name: 'HQ' });
  });
});

// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  getTaniumSettings: vi.fn(),
  getTaniumOrganizationMappings: vi.fn(),
  saveTaniumConfiguration: vi.fn(),
  testTaniumConnection: vi.fn(),
  syncTaniumScopes: vi.fn(),
  triggerTaniumFullSync: vi.fn(),
  disconnectTaniumIntegration: vi.fn(),
  updateTaniumOrganizationMapping: vi.fn(),
}));

vi.mock('../../../lib/actions/integrations/taniumActions', () => actions);

import TaniumIntegrationSettings from '../../../components/settings/integrations/TaniumIntegrationSettings';

describe('TaniumIntegrationSettings UI flow', () => {
  beforeEach(() => {
    (Object.values(actions) as Array<{ mockReset: () => void }>).forEach((fn) => fn.mockReset());

    actions.getTaniumSettings.mockResolvedValue({
      success: true,
      config: {
        gatewayUrl: 'https://tanium.example',
        assetApiUrl: '',
        useAssetApiFallback: false,
        isActive: false,
        connectedAt: null,
        syncStatus: 'pending',
        syncError: null,
      },
      credentials: { hasApiToken: false },
    });
    actions.getTaniumOrganizationMappings.mockResolvedValue({
      success: true,
      mappings: [
        {
          mapping_id: 'map_1',
          external_organization_id: 'scope_1',
          external_organization_name: 'Scope One',
          client_id: null,
          auto_sync_assets: true,
        },
      ],
      clients: [{ client_id: 'client_1', client_name: 'Client One' }],
    });
    actions.saveTaniumConfiguration.mockResolvedValue({ success: true });
    actions.testTaniumConnection.mockResolvedValue({ success: true });
    actions.syncTaniumScopes.mockResolvedValue({
      success: true,
      items_processed: 1,
      items_created: 1,
      items_updated: 0,
    });
    actions.triggerTaniumFullSync.mockResolvedValue({
      success: true,
      items_processed: 1,
      items_created: 1,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      errors: [],
    });
    actions.disconnectTaniumIntegration.mockResolvedValue({ success: true });
    actions.updateTaniumOrganizationMapping.mockResolvedValue({ success: true });
  });

  it('T008: supports config save, connection test, scope discovery, and mapping manager visibility', async () => {
    render(<TaniumIntegrationSettings />);

    await waitFor(() => expect(actions.getTaniumSettings).toHaveBeenCalled());
    expect(screen.getByText('Scope One')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('https://example.cloud.tanium.com'), {
      target: { value: 'https://tenant.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste Tanium API token'), {
      target: { value: 'token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => expect(actions.saveTaniumConfiguration).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() => expect(actions.testTaniumConnection).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Discover Scopes' }));
    await waitFor(() => expect(actions.syncTaniumScopes).toHaveBeenCalled());
  });
});

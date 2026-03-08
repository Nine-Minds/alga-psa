/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
}));

import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';

function buildStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    profiles: [
      {
        profileId: 'profile-1',
        displayName: 'Primary Profile',
        clientId: 'primary-client-id',
        tenantId: 'tenant-guid-1',
        clientSecretMasked: '••••1234',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-1_client_secret',
        isDefault: true,
        isArchived: false,
        readiness: {
          ready: true,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: true,
        },
        status: 'ready',
        archivedAt: null,
        consumers: ['Email', 'Calendar', 'MSP SSO'],
      },
      {
        profileId: 'profile-2',
        displayName: 'Archived Profile',
        clientId: 'archived-client-id',
        tenantId: 'tenant-guid-2',
        clientSecretMasked: '••••4321',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-2_client_secret',
        isDefault: false,
        isArchived: true,
        readiness: {
          ready: false,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: false,
        },
        status: 'archived',
        archivedAt: '2026-03-07T12:00:00.000Z',
        consumers: [],
      },
    ],
    ...overrides,
  };
}

describe('TeamsIntegrationSettings contracts', () => {
  beforeEach(() => {
    getMicrosoftIntegrationStatusMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus());
    window.location.hash = '';
  });

  it('T095/T096: renders the tenant-admin Teams setup UI and refresh path', async () => {
    const user = userEvent.setup();
    render(<TeamsIntegrationSettings />);

    expect((await screen.findAllByText('Microsoft Teams')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Guided tenant setup/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Primary Profile').length).toBeGreaterThan(0);
    expect(screen.queryByText('Archived Profile')).not.toBeInTheDocument();

    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    expect(refreshButtons.length).toBeGreaterThan(0);
    await user.click(refreshButtons[0]);

    await waitFor(() => {
      expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalledTimes(2);
    });
  });

  it('T111/T112/T115/T116: shows guided remediation and links back to Microsoft profile management when no eligible profile exists', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValueOnce(
      buildStatus({
        profiles: [
          {
            profileId: 'profile-2',
            displayName: 'Incomplete Profile',
            clientId: 'incomplete-client-id',
            tenantId: 'tenant-guid-2',
            clientSecretMasked: undefined,
            clientSecretConfigured: false,
            clientSecretRef: 'microsoft_profile_profile-2_client_secret',
            isDefault: false,
            isArchived: false,
            readiness: {
              ready: false,
              clientIdConfigured: true,
              clientSecretConfigured: false,
              tenantIdConfigured: true,
              active: true,
            },
            status: 'incomplete',
            archivedAt: null,
            consumers: [],
          },
        ],
      })
    );

    render(<TeamsIntegrationSettings />);

    expect(await screen.findByText('Create or repair a Microsoft profile before configuring Teams.')).toBeInTheDocument();
    expect(screen.getByText(/Teams setup stays blocked/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Microsoft Profiles' }));

    expect(window.location.hash).toBe('#microsoft-profile-manager');
  });

  it('shows load failures as actionable Teams setup errors', async () => {
    getMicrosoftIntegrationStatusMock.mockResolvedValueOnce({
      success: false,
      error: 'Forbidden',
    });

    render(<TeamsIntegrationSettings />);

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
  });
});

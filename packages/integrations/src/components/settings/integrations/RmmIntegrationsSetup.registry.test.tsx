// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="dynamic-component" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/msp/settings',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('./TacticalRmmIntegrationSettings', () => ({
  default: () => <div data-testid="tactical-settings">Tactical Settings</div>,
}));

vi.mock('../../../actions/integrations/rmmIntegrationStatusActions', () => ({
  getRmmIntegrationStatuses: vi.fn(async () => ({
    success: true,
    statuses: {
      tacticalrmm: {
        provider: 'tacticalrmm',
        isActive: true,
        syncStatus: 'completed',
        syncError: null,
        connectedAt: '2026-06-09T00:00:00.000Z',
        lastSyncAt: '2026-06-09T00:00:00.000Z',
        deviceCount: 2,
      },
    },
  })),
}));

vi.mock('../../../lib/rmm/providerRegistry', () => ({
  getAvailableRmmProviderRegistry: vi.fn(() => [
    {
      id: 'tacticalrmm',
      title: 'Registry Tactical',
      description: 'Registry-driven tactical card',
      icon: 'tacticalrmm',
      capabilities: {
        connection: true,
        scopeSync: true,
        deviceSync: true,
        events: true,
        remoteActions: true,
      },
      requiresEnterprise: false,
    },
  ]),
}));

import RmmIntegrationsSetup from './RmmIntegrationsSetup';
import { getAvailableRmmProviderRegistry } from '../../../lib/rmm/providerRegistry';

describe('RmmIntegrationsSetup registry rendering', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T001: renders provider rows from registry output without mounting settings', () => {
    render(<RmmIntegrationsSetup />);

    expect(getAvailableRmmProviderRegistry).toHaveBeenCalled();
    expect(screen.getByText('Registry Tactical')).toBeInTheDocument();
    expect(screen.getByText('Registry-driven tactical card')).toBeInTheDocument();
    expect(screen.queryByTestId('tactical-settings')).not.toBeInTheDocument();
  });

  it('T002: clicking a row opens the provider detail view and back returns to the list', () => {
    render(<RmmIntegrationsSetup />);

    fireEvent.click(screen.getByText('Registry Tactical'));

    expect(screen.getByTestId('tactical-settings')).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/msp/settings?rmmProvider=tacticalrmm', { scroll: false });

    fireEvent.click(screen.getByText('All RMM integrations'));

    expect(screen.queryByTestId('tactical-settings')).not.toBeInTheDocument();
    expect(screen.getByText('Registry Tactical')).toBeInTheDocument();
  });

  it('T003: renders connection status from the status action', async () => {
    render(<RmmIntegrationsSetup />);

    expect(await screen.findByText('Connected · 2 devices')).toBeInTheDocument();
  });
});

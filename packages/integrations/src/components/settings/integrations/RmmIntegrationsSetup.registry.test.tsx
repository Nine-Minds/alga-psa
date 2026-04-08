// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="dynamic-component" />,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: vi.fn((flag: string) => ({ enabled: flag === 'tactical-rmm-integration' })),
}));

vi.mock('./TacticalRmmIntegrationSettings', () => ({
  default: () => <div data-testid="tactical-settings">Tactical Settings</div>,
}));

vi.mock('../../../lib/rmm/providerRegistry', () => ({
  getAvailableRmmProviderRegistry: vi.fn(() => [
    {
      id: 'tacticalrmm',
      title: 'Registry Tactical',
      description: 'Registry-driven tactical card',
      icon: 'tacticalrmm',
      highlights: [{ label: 'Sync', value: 'Devices' }],
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T001: renders provider options from registry output', () => {
    render(<RmmIntegrationsSetup />);

    expect(getAvailableRmmProviderRegistry).toHaveBeenCalled();
    expect(screen.getByText('Registry Tactical')).toBeInTheDocument();
    expect(screen.getByText('Registry-driven tactical card')).toBeInTheDocument();
    expect(screen.getByTestId('tactical-settings')).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallLinkContext } from '@alga-psa/ui/components/CallLink';
import { MspCallLinkProvider } from '@/components/layout/MspCallLinkProvider';

const hoisted = vi.hoisted(() => ({
  getState: vi.fn(),
  createIntent: vi.fn(),
  hasAddOn: vi.fn(() => true),
}));

vi.mock('@/context/TierContext', () => ({
  useTier: () => ({ hasAddOn: hoisted.hasAddOn }),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTelephonyCallLinkState: hoisted.getState,
  createTelephonyCallIntent: hoisted.createIntent,
}));

function StateProbe() {
  const state = useCallLinkContext();
  return (
    <div>
      <span>{state.teamsCallEnabled ? 'teams-active' : 'teams-inactive'}</span>
      <span>{state.teamsPhoneConnected ? 'phone-connected' : 'phone-disconnected'}</span>
    </div>
  );
}

describe('MspCallLinkProvider', () => {
  beforeEach(() => {
    hoisted.getState.mockReset();
    hoisted.createIntent.mockReset();
    hoisted.hasAddOn.mockReset();
    hoisted.hasAddOn.mockReturnValue(true);
  });

  it('uses active integration/provider state instead of the add-on alone', async () => {
    hoisted.getState.mockResolvedValue({
      success: true,
      teamsIntegrationActive: true,
      teamsPhoneConnected: false,
    });

    render(
      <MspCallLinkProvider>
        <StateProbe />
      </MspCallLinkProvider>,
    );

    await waitFor(() => expect(screen.getByText('teams-active')).toBeTruthy());
    expect(screen.getByText('phone-disconnected')).toBeTruthy();
    expect(hoisted.getState).toHaveBeenCalledTimes(1);
  });

  it('does not read integration state when the tenant lacks the Teams add-on', async () => {
    hoisted.hasAddOn.mockReturnValue(false);

    render(
      <MspCallLinkProvider>
        <StateProbe />
      </MspCallLinkProvider>,
    );

    expect(screen.getByText('teams-inactive')).toBeTruthy();
    expect(screen.getByText('phone-disconnected')).toBeTruthy();
    await Promise.resolve();
    expect(hoisted.getState).not.toHaveBeenCalled();
  });
});

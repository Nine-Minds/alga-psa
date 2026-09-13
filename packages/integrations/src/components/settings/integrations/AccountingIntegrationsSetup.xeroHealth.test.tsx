/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useAccountingCapabilitiesMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }));
vi.mock('./CSVIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./XeroCsvIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./QboIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: useAccountingCapabilitiesMock
}));

// Capture the props AccountingIntegrationsSetup passes into the Xero flow and
// render the health slot so the composition is observable.
vi.mock('./XeroIntegrationSettings', () => ({
  __esModule: true,
  default: ({ syncHealthSlot }: { syncHealthSlot?: React.ReactNode }) => (
    <div data-testid="xero-settings-stub">{syncHealthSlot}</div>
  )
}));

const fullCaps = {
  catalogRead: true,
  connectionsManage: true,
  mappingsManage: true,
  exportsExecute: true,
  remoteMutate: true,
  hasAny: true,
  loaded: true
};

describe('AccountingIntegrationsSetup mounts provider-aware health in the Xero flow', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useSearchParamsMock.mockReturnValue(new URLSearchParams('accounting_integration=xero'));
    useAccountingCapabilitiesMock.mockReturnValue(fullCaps);
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
    cleanup();
    vi.clearAllMocks();
  });

  it('passes the sync-health/Sync Now slot into the selected Xero configuration', async () => {
    const { default: AccountingIntegrationsSetup } = await import('./AccountingIntegrationsSetup');

    render(
      <AccountingIntegrationsSetup
        qboSyncHealthSlot={<div id="provider-sync-health">Sync Now</div>}
      />
    );

    const xeroFlow = screen.getByTestId('xero-settings-stub');
    expect(xeroFlow).toBeInTheDocument();
    expect(xeroFlow.querySelector('#provider-sync-health')).toBeTruthy();
  });
});

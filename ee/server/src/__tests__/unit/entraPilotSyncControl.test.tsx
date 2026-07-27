// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PilotSyncControl } from '@ee/components/settings/integrations/entra/PilotSyncControl';

const {
  getEntraConfirmedMappingsMock,
  runEntraPreflightMock,
  startEntraSyncMock,
  updateEntraFieldSyncConfigMock,
} = vi.hoisted(() => ({
  getEntraConfirmedMappingsMock: vi.fn(),
  runEntraPreflightMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
  updateEntraFieldSyncConfigMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraConfirmedMappings: getEntraConfirmedMappingsMock,
  runEntraPreflight: runEntraPreflightMock,
  startEntraSync: startEntraSyncMock,
  updateEntraFieldSyncConfig: updateEntraFieldSyncConfigMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => {
  // CustomSelect is a default export.
  const CustomSelect = ({
    id,
    value,
    onValueChange,
    options,
  }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return { __esModule: true, default: CustomSelect, CustomSelect };
});

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    managedTenantId: 'managed-1',
    entraTenantId: 'entra-1',
    clientId: 'client-1',
    clientName: 'Contoso',
    displayName: 'Contoso Ltd',
    primaryDomain: 'contoso.com',
    sourceUserCount: 12,
    lastSyncedAt: null,
    lastRunStatus: null,
    ...overrides,
  };
}

const syncRemainingButton = () =>
  document.getElementById('entra-pilot-sync-remaining') as HTMLButtonElement;

describe('PilotSyncControl', () => {
  beforeEach(() => {
    getEntraConfirmedMappingsMock.mockReset();
    runEntraPreflightMock.mockReset();
    startEntraSyncMock.mockReset();
    startEntraSyncMock.mockResolvedValue({ success: true, data: { accepted: true, runId: 'run-1' } });
  });

  it('keeps "sync the remaining" locked until a pilot run has completed', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [mapping(), mapping({ managedTenantId: 'managed-2', clientId: 'client-2', clientName: 'Fabrikam' })] },
    });

    render(<PilotSyncControl />);
    await screen.findByText('Contoso');

    expect(syncRemainingButton().disabled).toBe(true);
    expect(document.getElementById('entra-pilot-gate-note')).not.toBeNull();

    // Starting the pilot is not enough — a started run is a promise, not evidence.
    fireEvent.click(document.getElementById('entra-pilot-sync') as HTMLButtonElement);
    await waitFor(() => expect(startEntraSyncMock).toHaveBeenCalledTimes(1));
    expect(startEntraSyncMock).toHaveBeenCalledWith({
      scope: 'single-client',
      clientId: 'client-1',
      managedTenantId: 'managed-1',
    });
    expect(syncRemainingButton().disabled).toBe(true);
  });

  it('unlocks the rest once a run for one client has completed', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: {
        mappings: [
          mapping({ lastRunStatus: 'completed', lastSyncedAt: '2026-07-25T10:00:00.000Z' }),
          mapping({ managedTenantId: 'managed-2', clientId: 'client-2', clientName: 'Fabrikam' }),
        ],
      },
    });

    render(<PilotSyncControl />);
    await screen.findByText('Contoso');

    expect(syncRemainingButton().disabled).toBe(false);
    expect(document.getElementById('entra-pilot-gate-note')).toBeNull();

    fireEvent.click(syncRemainingButton());
    await waitFor(() => expect(startEntraSyncMock).toHaveBeenCalledWith({ scope: 'all-tenants' }));
  });

  it('shows the preflight buckets with expandable names, and syncs nothing to get them', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [mapping()] },
    });
    runEntraPreflightMock.mockResolvedValue({
      success: true,
      data: {
        runId: 'preflight-1',
        managedTenantId: 'managed-1',
        clientId: 'client-1',
        checkedAt: '2026-07-25T12:00:00.000Z',
        totalIdentities: 3,
        counters: { created: 2, linked: 1, updated: 0, ambiguous: 0, inactivated: 0 },
        buckets: [
          {
            bucket: 'create',
            count: 2,
            samples: [
              { bucket: 'create', entraObjectId: 'o1', displayName: 'Ada Lovelace', email: 'ada@contoso.com', userPrincipalName: 'ada@contoso.com' },
              { bucket: 'create', entraObjectId: 'o2', displayName: 'Alan Turing', email: 'alan@contoso.com', userPrincipalName: 'alan@contoso.com' },
            ],
          },
          { bucket: 'link', count: 1, samples: [] },
          { bucket: 'needs_decision', count: 0, samples: [] },
          { bucket: 'no_change', count: 0, samples: [] },
          { bucket: 'mark_inactive', count: 0, samples: [] },
        ],
      },
    });

    render(<PilotSyncControl />);
    await screen.findByText('Contoso');

    fireEvent.click(document.getElementById('entra-pilot-preflight') as HTMLButtonElement);
    await waitFor(() => expect(document.getElementById('entra-preflight-report')).not.toBeNull());

    expect(runEntraPreflightMock).toHaveBeenCalledWith({ managedTenantId: 'managed-1' });
    expect(startEntraSyncMock).not.toHaveBeenCalled();
    expect(
      document.querySelector('#entra-preflight-bucket-create [data-bucket-count]')?.textContent
    ).toBe('2');

    fireEvent.click(document.getElementById('entra-preflight-expand-create') as HTMLButtonElement);
    expect(document.getElementById('entra-preflight-samples-create')?.textContent).toContain(
      'Ada Lovelace'
    );
  });

  it('does not claim a sync started when the worker never took it', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [mapping()] },
    });
    // The request succeeded; the workflow was never accepted, so no run exists.
    startEntraSyncMock.mockResolvedValue({
      success: true,
      data: { accepted: false, runId: null, error: 'Temporal client not available' },
    });

    render(<PilotSyncControl />);
    await screen.findByText('Contoso');

    fireEvent.click(document.getElementById('entra-pilot-sync') as HTMLButtonElement);

    await waitFor(() => expect(document.getElementById('entra-pilot-error')).not.toBeNull());
    expect(document.getElementById('entra-pilot-error')?.textContent).toContain('did not start');
    expect(document.getElementById('entra-pilot-message')).toBeNull();
  });

  it('says so plainly when nothing is mapped yet', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({ success: true, data: { mappings: [] } });

    render(<PilotSyncControl />);

    await waitFor(() => expect(document.getElementById('entra-pilot-empty')).not.toBeNull());
    expect(document.getElementById('entra-pilot-control')).toBeNull();
  });
});

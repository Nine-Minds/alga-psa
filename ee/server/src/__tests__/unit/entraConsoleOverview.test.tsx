// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraConsole } from '@ee/components/settings/integrations/entra/EntraConsole';
import type { EntraStatusResponse } from '@alga-psa/integrations/actions';

const {
  getEntraConfirmedMappingsMock,
  getEntraReconciliationQueueMock,
  getEntraSyncRunDetailMock,
  getEntraSyncRunHistoryMock,
  getEntraSyncScheduleMock,
  saveEntraSyncScheduleMock,
  startEntraSyncMock,
} = vi.hoisted(() => ({
  getEntraConfirmedMappingsMock: vi.fn(),
  getEntraReconciliationQueueMock: vi.fn(),
  getEntraSyncRunDetailMock: vi.fn(),
  getEntraSyncRunHistoryMock: vi.fn(),
  getEntraSyncScheduleMock: vi.fn(),
  saveEntraSyncScheduleMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  disconnectEntraIntegration: vi.fn(),
  getEntraConfirmedMappings: getEntraConfirmedMappingsMock,
  getEntraReconciliationQueue: getEntraReconciliationQueueMock,
  getEntraSyncRunDetail: getEntraSyncRunDetailMock,
  getEntraSyncRunHistory: getEntraSyncRunHistoryMock,
  getEntraSyncSchedule: getEntraSyncScheduleMock,
  initiateEntraDirectOAuth: vi.fn(),
  runEntraPreflight: vi.fn(),
  saveEntraSyncSchedule: saveEntraSyncScheduleMock,
  startEntraSync: startEntraSyncMock,
  unmapEntraTenant: vi.fn(),
  updateEntraFieldSyncConfig: vi.fn(),
  validateEntraCippConnection: vi.fn(),
  validateEntraDirectConnection: vi.fn(),
}));

// The tabs behind the overview have their own suites; the console only needs to
// prove it mounts them.
vi.mock('@ee/components/settings/integrations/EntraTenantMappingTable', () => ({
  EntraTenantMappingTable: () => <div id="entra-mapping-table-stub" />,
}));
vi.mock('@ee/components/settings/integrations/EntraReconciliationQueue', () => ({
  default: () => <div id="entra-review-queue-stub" />,
}));
vi.mock('@ee/components/settings/integrations/EntraCippConnectDialog', () => ({
  EntraCippConnectDialog: () => null,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, id }: { isOpen: boolean; id?: string }) =>
    isOpen ? <div id={id} /> : null,
}));

function statusOf(overrides: Partial<EntraStatusResponse> = {}): EntraStatusResponse {
  return {
    status: 'connected',
    connectionType: 'direct',
    lastDiscoveryAt: '2026-07-25T09:00:00.000Z',
    mappedTenantCount: 2,
    nextSyncIntervalMinutes: 1440,
    hasCompletedFirstSync: true,
    availableConnectionTypes: ['direct', 'cipp'],
    lastValidatedAt: '2026-07-25T09:30:00.000Z',
    lastValidationError: null,
    fieldSyncConfig: {
      displayName: false,
      email: false,
      phone: true,
      role: false,
      upn: false,
      markInactiveWhenDisabled: true,
    },
    ...overrides,
  };
}

const CONTOSO = {
  managedTenantId: 'managed-1',
  entraTenantId: 'entra-1',
  clientId: 'client-1',
  clientName: 'Contoso Ltd',
  displayName: 'Contoso',
  primaryDomain: 'contoso.com',
  sourceUserCount: 153,
  lastSyncedAt: '2026-07-25T03:04:00.000Z',
  lastRunStatus: 'completed',
};

const FABRIKAM = {
  ...CONTOSO,
  managedTenantId: 'managed-2',
  entraTenantId: 'entra-2',
  clientId: 'client-2',
  clientName: 'Fabrikam Inc',
  displayName: 'Fabrikam',
  primaryDomain: 'fabrikam.com',
  sourceUserCount: 76,
  lastRunStatus: 'failed',
};

describe('EntraConsole overview', () => {
  beforeEach(() => {
    getEntraConfirmedMappingsMock.mockReset();
    getEntraReconciliationQueueMock.mockReset();
    getEntraSyncRunDetailMock.mockReset();
    getEntraSyncRunHistoryMock.mockReset();
    getEntraSyncScheduleMock.mockReset();
    saveEntraSyncScheduleMock.mockReset();
    startEntraSyncMock.mockReset();

    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [CONTOSO, FABRIKAM] },
    });
    getEntraSyncRunHistoryMock.mockResolvedValue({
      success: true,
      data: {
        runs: [
          {
            runId: 'preview-1',
            status: 'completed',
            runType: 'preflight',
            startedAt: '2026-07-25T04:00:00.000Z',
            completedAt: '2026-07-25T04:00:10.000Z',
            totalTenants: 1,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
            isDryRun: true,
          },
          {
            runId: 'run-1',
            status: 'partial',
            runType: 'all-tenants',
            startedAt: '2026-07-25T03:04:00.000Z',
            completedAt: '2026-07-25T03:05:00.000Z',
            totalTenants: 2,
            processedTenants: 2,
            succeededTenants: 1,
            failedTenants: 1,
            isDryRun: false,
          },
        ],
      },
    });
    getEntraSyncRunDetailMock.mockResolvedValue({
      success: true,
      data: {
        run: null,
        tenantResults: [
          {
            managedTenantId: 'managed-1',
            clientId: 'client-1',
            status: 'completed',
            created: 2,
            linked: 153,
            updated: 1,
            ambiguous: 0,
            inactivated: 1,
            errorMessage: null,
            startedAt: '2026-07-25T03:04:00.000Z',
            completedAt: '2026-07-25T03:04:30.000Z',
          },
          {
            managedTenantId: 'managed-2',
            clientId: 'client-2',
            status: 'failed',
            created: 0,
            linked: 0,
            updated: 0,
            ambiguous: 0,
            inactivated: 0,
            errorMessage: 'CIPP returned 401',
            startedAt: '2026-07-25T03:05:00.000Z',
            completedAt: null,
          },
        ],
      },
    });
    getEntraSyncScheduleMock.mockResolvedValue({
      success: true,
      data: { syncEnabled: true, syncIntervalMinutes: 1440, updatedAt: null },
    });
    getEntraReconciliationQueueMock.mockResolvedValue({
      success: true,
      data: { items: [{ queueItemId: 'q1' }, { queueItemId: 'q2' }] },
    });
    saveEntraSyncScheduleMock.mockResolvedValue({
      success: true,
      data: { syncEnabled: false, syncIntervalMinutes: 1440, updatedAt: null, scheduleApplied: true },
    });

    // The console deep-links from ?tab=, so each test starts on a clean URL.
    window.history.replaceState({}, '', '/msp/settings/integrations/entra');
  });

  const renderConsole = (status = statusOf()) =>
    render(<EntraConsole status={status} cippAvailable onStatusChanged={vi.fn()} />);

  it('leads with what the last run did to the contact list, per client and in total', async () => {
    renderConsole();

    await waitFor(() =>
      expect(document.getElementById('entra-console-last-run-stats')).not.toBeNull()
    );

    // The dry run is a preview, so the numbers come from the last real run.
    expect(getEntraSyncRunDetailMock).toHaveBeenCalledWith('run-1');

    const stats = document.getElementById('entra-console-last-run-stats');
    expect(stats?.querySelector('#entra-console-stat-linked')?.textContent).toContain('153');
    expect(stats?.querySelector('#entra-console-stat-created')?.textContent).toContain('2');
    expect(stats?.querySelector('#entra-console-stat-inactivated')?.textContent).toContain('1');
    expect(stats?.querySelector('#entra-console-stat-failed')?.textContent).toContain('1');

    // Clients are named the way the MSP names them, not by tenant GUID.
    const table = document.getElementById('entra-console-last-run-clients');
    expect(table?.textContent).toContain('Contoso Ltd');
    expect(table?.textContent).toContain('Fabrikam Inc');
    expect(table?.textContent).not.toContain('managed-1');
  });

  it('says what the run did in words, not by printing its database status', async () => {
    renderConsole();

    await waitFor(() =>
      expect(document.getElementById('entra-console-last-run')).not.toBeNull()
    );

    // It used to interpolate the raw enum into "{{status}} at {{time}}" and
    // render "partial at 7/25/2026, 3:05:00 AM" in all ten locales.
    const summary = document.getElementById('entra-console-last-run')?.textContent || '';
    expect(summary).toContain('with failures');
    expect(summary).not.toContain('partial');
    expect(summary).not.toMatch(/\d{4}/);
  });

  it('reports a run still in flight as running, not as a run that did nothing', async () => {
    getEntraSyncRunHistoryMock.mockResolvedValue({
      success: true,
      data: {
        runs: [
          {
            runId: 'run-live',
            status: 'running',
            runType: 'all-tenants',
            startedAt: '2026-07-25T03:04:00.000Z',
            completedAt: null,
            totalTenants: 2,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
            isDryRun: false,
          },
        ],
      },
    });
    getEntraSyncRunDetailMock.mockResolvedValue({
      success: true,
      data: { run: null, tenantResults: [] },
    });

    renderConsole();

    // The per-client results are not written until the run ends, so the stat
    // strip read 0 linked / 0 created — "the sync did nothing" rather than
    // "the sync is not finished".
    await waitFor(() =>
      expect(document.getElementById('entra-console-last-run-progress')?.textContent).toContain(
        '1 of 2 clients'
      )
    );
    expect(document.getElementById('entra-console-last-run')?.textContent).toContain(
      'still running'
    );
    expect(document.getElementById('entra-console-last-run-stats')).toBeNull();
  });

  it('states what needs attention, why, and offers the action for it', async () => {
    renderConsole();

    await waitFor(() =>
      expect(document.getElementById('entra-console-attention-list')).not.toBeNull()
    );

    const list = document.getElementById('entra-console-attention-list');
    // One failing client, named — not a bare count.
    expect(list?.textContent).toContain('Fabrikam Inc');
    expect(list?.textContent).toContain('waiting for a decision');
    expect(document.getElementById('entra-console-attention-failed-clients')?.textContent)
      .toContain('View clients');
    expect(document.getElementById('entra-console-attention-review-queue')?.textContent)
      .toContain('Review');
  });

  it('shows the health of the whole integration in the header', async () => {
    renderConsole();

    await waitFor(() =>
      // One is one: the count reads as English, not as a template.
      expect(document.getElementById('entra-console-health')?.textContent).toContain(
        '1 client failing'
      )
    );
    expect(document.getElementById('entra-console-lead')?.textContent).toContain(
      '2 clients mapped'
    );
  });

  it('says healthy only when every client is', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [CONTOSO] },
    });

    renderConsole();

    await waitFor(() =>
      expect(document.getElementById('entra-console-health')?.textContent).toBe('Healthy')
    );
  });

  it('does not answer the operator before it has asked the server', async () => {
    // Every reader resolves on a promise the test controls, so the assertions
    // below run against the first paint.
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    getEntraConfirmedMappingsMock.mockImplementation(async () => {
      await held;
      return { success: true, data: { mappings: [CONTOSO, FABRIKAM] } };
    });

    renderConsole();

    // The screen used to open with "Healthy" and "Nothing needs attention",
    // both computed from empty arrays it had not filled yet.
    expect(document.getElementById('entra-console-health')?.textContent).toBe('Checking…');
    expect(document.getElementById('entra-console-attention-loading')).not.toBeNull();
    expect(document.getElementById('entra-console-attention-empty')).toBeNull();
    expect(document.getElementById('entra-console-last-run-empty')).toBeNull();

    release?.();
    await waitFor(() =>
      expect(document.getElementById('entra-console-health')?.textContent).toContain(
        '1 client failing'
      )
    );
  });

  it('says a read failed instead of rendering the failure as an empty tenant', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      error: 'Forbidden: insufficient permissions to view Entra integration',
    });

    renderConsole();

    // Every reader used to be an `if` with no `else`, so a Forbidden envelope
    // left mappings at [] and the screen reported a healthy, empty tenant.
    await waitFor(() =>
      expect(document.getElementById('entra-console-load-error')?.textContent).toContain(
        'Forbidden'
      )
    );
    expect(document.getElementById('entra-console-attention-empty')).toBeNull();
    expect(document.getElementById('entra-console-health')?.textContent).toBe('Status unknown');

    // And it offers the way out rather than leaving the operator to guess.
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [CONTOSO] },
    });
    fireEvent.click(document.getElementById('entra-console-load-retry') as HTMLButtonElement);
    await waitFor(() =>
      expect(document.getElementById('entra-console-health')?.textContent).toBe('Healthy')
    );
  });

  it('says so when a reader never answers at all', async () => {
    getEntraSyncRunHistoryMock.mockRejectedValue(new Error('Failed to fetch'));

    renderConsole();

    // A rejected action skipped the envelope checks entirely and left the
    // state empty, which read as "no sync has run yet".
    await waitFor(() =>
      expect(document.getElementById('entra-console-load-error')?.textContent).toContain(
        'Failed to fetch'
      )
    );
    expect(document.getElementById('entra-console-last-run-empty')).toBeNull();
  });

  it('does not call a tenant healthy because its clients only partly failed', async () => {
    getEntraConfirmedMappingsMock.mockResolvedValue({
      success: true,
      data: { mappings: [{ ...CONTOSO, lastRunStatus: 'partial' }] },
    });

    renderConsole();

    // The header used to test lastRunStatus === 'failed' and nothing else, so a
    // partly failed client read "Healthy" here and "Failing" on the Clients tab.
    await waitFor(() =>
      expect(document.getElementById('entra-console-health')?.textContent).toContain(
        '1 client failing'
      )
    );
    expect(document.getElementById('entra-console-attention-failed-clients')).not.toBeNull();
  });

  it('pauses automatic sync from the header without leaving the overview', async () => {
    renderConsole();

    await waitFor(() => expect(document.getElementById('entra-console-pause')).not.toBeNull());
    expect(document.getElementById('entra-console-pause')?.textContent).toBe('Pause sync');

    fireEvent.click(document.getElementById('entra-console-pause') as HTMLButtonElement);

    await waitFor(() =>
      expect(saveEntraSyncScheduleMock).toHaveBeenCalledWith({
        syncEnabled: false,
        syncIntervalMinutes: 1440,
      })
    );
    expect(await screen.findByText('Automatic sync paused.')).toBeInTheDocument();
    // The button now offers the opposite, rather than repeating what just happened.
    await waitFor(() =>
      expect(document.getElementById('entra-console-pause')?.textContent).toBe('Resume sync')
    );
  });

  it('offers a way back in when the connection has been removed', async () => {
    // Disconnecting keeps the contacts and the mappings, so the console has to
    // keep a way to reconnect — otherwise the integration is unrecoverable from
    // the only screen that still knows about it.
    // Deep-link straight to the tab the attention item sends the operator to.
    window.history.replaceState({}, '', '/msp/settings/integrations/entra?tab=connection');
    renderConsole(statusOf({ status: 'not_connected', connectionType: null }));

    await waitFor(() =>
      expect(document.getElementById('entra-console-reconnect')).not.toBeNull()
    );
    expect(document.getElementById('entra-connection-method-chooser')).not.toBeNull();
    // The controls that need an existing connection stay out of the way.
    expect((document.getElementById('entra-console-rotate') as HTMLButtonElement)?.disabled).toBe(true);
  });

  it('summarises the overwrite rules that are actually in force', async () => {
    renderConsole();

    await waitFor(() =>
      expect(document.getElementById('entra-console-rail-overwrites')).not.toBeNull()
    );

    const rail = document.getElementById('entra-console-rail-overwrites');
    expect(rail?.textContent).toContain('Phone');
    expect(rail?.textContent).toContain('On');
    expect(rail?.textContent).toContain('Off');
  });
});

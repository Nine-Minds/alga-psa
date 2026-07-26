// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraClientsTab } from '@ee/components/settings/integrations/entra/EntraClientsTab';
import type { EntraConfirmedMapping } from '@alga-psa/integrations/actions';

const { runEntraPreflightMock, startEntraSyncMock, unmapEntraTenantMock } = vi.hoisted(() => ({
  runEntraPreflightMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
  unmapEntraTenantMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  runEntraPreflight: runEntraPreflightMock,
  startEntraSync: startEntraSyncMock,
  unmapEntraTenant: unmapEntraTenantMock,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    id,
    title,
    message,
    onConfirm,
  }: {
    isOpen: boolean;
    id?: string;
    title?: string;
    message?: React.ReactNode;
    onConfirm?: () => void;
  }) =>
    isOpen ? (
      <div id={id}>
        <p>{title}</p>
        <div>{message}</div>
        <button id={`${id}-confirm`} type="button" onClick={onConfirm}>
          confirm
        </button>
      </div>
    ) : null,
}));

function client(overrides: Partial<EntraConfirmedMapping> = {}): EntraConfirmedMapping {
  return {
    managedTenantId: 'managed-1',
    entraTenantId: 'entra-1',
    clientId: 'client-1',
    clientName: 'Contoso',
    displayName: 'Contoso Ltd',
    primaryDomain: 'contoso.com',
    sourceUserCount: 12,
    lastSyncedAt: '2026-07-25T10:00:00.000Z',
    lastRunStatus: 'completed',
    ...overrides,
  };
}

const rowText = () =>
  Array.from(document.querySelectorAll('tbody tr')).map((row) => row.textContent || '');

describe('EntraClientsTab', () => {
  beforeEach(() => {
    runEntraPreflightMock.mockReset();
    startEntraSyncMock.mockReset();
    unmapEntraTenantMock.mockReset();
    startEntraSyncMock.mockResolvedValue({ success: true, data: { accepted: true, runId: 'run-1' } });
    unmapEntraTenantMock.mockResolvedValue({ success: true, data: {} });
  });

  const renderTab = (mappings: EntraConfirmedMapping[], onOpenConnection?: () => void) =>
    render(
      <EntraClientsTab
        mappings={mappings}
        loading={false}
        onChanged={vi.fn()}
        onOpenConnection={onOpenConnection}
      />
    );

  it('puts the clients that need a person at the top', () => {
    renderTab([
      client({ managedTenantId: 'ok', clientName: 'Healthy Ltd' }),
      client({ managedTenantId: 'failed', clientName: 'Broken Ltd', lastRunStatus: 'failed' }),
      client({ managedTenantId: 'partial', clientName: 'Partly Ltd', lastRunStatus: 'partial' }),
    ]);

    const order = rowText().map((text) => text.slice(0, 12));
    expect(order[0]).toContain('Broken');
    expect(order[1]).toContain('Partly');
    expect(order[2]).toContain('Healthy');
  });

  it('does not tell an operator a syncing or partly failed client has never synced', () => {
    renderTab([
      client({ managedTenantId: 'running', clientName: 'Running Ltd', lastRunStatus: 'running' }),
      client({ managedTenantId: 'partial', clientName: 'Partly Ltd', lastRunStatus: 'partial' }),
    ]);

    const rows = rowText().join(' ');
    expect(rows).toContain('Syncing');
    expect(rows).toContain('Partly failed');
    expect(rows).not.toContain('Never synced');
  });

  it('counts each filter so the operator knows whether it is worth clicking', () => {
    renderTab([
      client({ managedTenantId: 'a', lastRunStatus: 'failed' }),
      client({ managedTenantId: 'b', lastRunStatus: 'partial' }),
      client({ managedTenantId: 'c', lastRunStatus: 'completed' }),
      client({ managedTenantId: 'd', lastRunStatus: null, lastSyncedAt: null }),
    ]);

    expect(document.getElementById('entra-clients-filter-all')?.textContent).toContain('4');
    // A partly failed client is a failing client; it used to match no filter.
    expect(document.getElementById('entra-clients-filter-failing')?.textContent).toContain('2');
    expect(document.getElementById('entra-clients-filter-never-synced')?.textContent).toContain('1');

    fireEvent.click(document.getElementById('entra-clients-filter-failing') as HTMLButtonElement);
    expect(rowText()).toHaveLength(2);
  });

  it('separates "nothing is mapped" from "nothing matched"', () => {
    const openConnection = vi.fn();
    const { unmount } = renderTab([], openConnection);

    expect(document.getElementById('entra-clients-empty-unmapped')).not.toBeNull();
    fireEvent.click(document.getElementById('entra-clients-open-connection') as HTMLButtonElement);
    expect(openConnection).toHaveBeenCalledTimes(1);
    unmount();

    renderTab([client()]);
    fireEvent.change(document.getElementById('entra-clients-search') as HTMLInputElement, {
      target: { value: 'nothing-matches-this' },
    });
    expect(document.getElementById('entra-clients-empty')).not.toBeNull();
    expect(document.getElementById('entra-clients-empty-unmapped')).toBeNull();

    fireEvent.click(document.getElementById('entra-clients-clear-filters') as HTMLButtonElement);
    expect(rowText()).toHaveLength(1);
  });

  it('previews once, then toggles the panel instead of asking Microsoft again', async () => {
    runEntraPreflightMock.mockResolvedValue({
      success: true,
      data: {
        runId: 'preflight-1',
        managedTenantId: 'managed-1',
        clientId: 'client-1',
        checkedAt: '2026-07-25T12:00:00.000Z',
        totalIdentities: 1,
        counters: { created: 1, linked: 0, updated: 0, ambiguous: 0, inactivated: 0 },
        buckets: [{ bucket: 'create', count: 1, samples: [] }],
      },
    });

    renderTab([client()]);
    const preview = () => document.getElementById('entra-client-preview-managed-1') as HTMLButtonElement;

    fireEvent.click(preview());
    await waitFor(() => expect(document.getElementById('entra-preflight-report')).not.toBeNull());
    expect(runEntraPreflightMock).toHaveBeenCalledTimes(1);

    fireEvent.click(preview());
    expect(document.getElementById('entra-preflight-report')).toBeNull();

    fireEvent.click(preview());
    expect(document.getElementById('entra-preflight-report')).not.toBeNull();
    // Every extra click used to cost a Graph round trip and a row in run history.
    expect(runEntraPreflightMock).toHaveBeenCalledTimes(1);
  });

  it('says what it is doing while it reads the directory', async () => {
    let release: ((value: unknown) => void) | null = null;
    runEntraPreflightMock.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );

    renderTab([client()]);
    fireEvent.click(document.getElementById('entra-client-preview-managed-1') as HTMLButtonElement);

    // The row used to sit there with nothing but a changed button label while a
    // live call to Microsoft ran for as long as the client's user count took.
    const loading = document.getElementById('entra-client-preview-loading-managed-1');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('Contoso');
    expect(loading?.getAttribute('aria-busy')).toBe('true');

    release?.({
      success: true,
      data: {
        runId: 'preflight-1',
        managedTenantId: 'managed-1',
        clientId: 'client-1',
        checkedAt: '2026-07-25T12:00:00.000Z',
        totalIdentities: 1,
        counters: { created: 1, linked: 0, updated: 0, ambiguous: 0, inactivated: 0 },
        buckets: [{ bucket: 'create', count: 1, samples: [] }],
      },
    });

    await waitFor(() =>
      expect(document.getElementById('entra-preflight-report')).not.toBeNull()
    );
    expect(document.getElementById('entra-client-preview-loading-managed-1')).toBeNull();
  });

  it('offers a re-check, and says how old the report it is showing is', async () => {
    const preflight = (checkedAt: string) => ({
      success: true,
      data: {
        runId: 'preflight-1',
        managedTenantId: 'managed-1',
        clientId: 'client-1',
        checkedAt,
        totalIdentities: 1,
        counters: { created: 1, linked: 0, updated: 0, ambiguous: 0, inactivated: 0 },
        buckets: [{ bucket: 'create', count: 1, samples: [] }],
      },
    });
    runEntraPreflightMock.mockResolvedValue(preflight('2026-07-25T12:00:00.000Z'));

    renderTab([client()]);
    fireEvent.click(document.getElementById('entra-client-preview-managed-1') as HTMLButtonElement);
    await waitFor(() => expect(document.getElementById('entra-preflight-report')).not.toBeNull());

    // The preview is cached until this client syncs, so it can be far older
    // than opening the panel suggests. The age is on screen, and there is a way
    // to get a fresh one without syncing.
    expect(document.getElementById('entra-preflight-age')).not.toBeNull();

    expect(runEntraPreflightMock).toHaveBeenCalledTimes(1);
    fireEvent.click(document.getElementById('entra-preflight-recheck') as HTMLButtonElement);
    await waitFor(() => expect(runEntraPreflightMock).toHaveBeenCalledTimes(2));
  });

  it('surfaces a timeout as itself rather than as a generic failure', async () => {
    runEntraPreflightMock.mockResolvedValue({
      success: false,
      error: 'CIPP did not answer within 20 seconds. It may still be gathering the directory — try again in a moment.',
    });

    renderTab([client()]);
    fireEvent.click(document.getElementById('entra-client-preview-managed-1') as HTMLButtonElement);

    await waitFor(() =>
      expect(document.getElementById('entra-clients-error')?.textContent).toContain('20 seconds')
    );
    // No half-open panel left behind with nothing in it.
    expect(document.getElementById('entra-preflight-report')).toBeNull();
    expect(document.getElementById('entra-client-preview-loading-managed-1')).toBeNull();
  });

  it('says so when unlinking is refused, instead of closing on a failure', async () => {
    unmapEntraTenantMock.mockResolvedValue({
      success: false,
      error: 'Forbidden: insufficient permissions to configure Entra integration',
    });

    renderTab([client()]);
    fireEvent.click(document.getElementById('entra-client-unlink-managed-1') as HTMLButtonElement);
    expect(document.getElementById('entra-client-unlink-dialog')?.textContent).toContain(
      'Stop syncing Contoso?'
    );

    fireEvent.click(document.getElementById('entra-client-unlink-dialog-confirm') as HTMLButtonElement);

    await waitFor(() =>
      expect(document.getElementById('entra-clients-error')?.textContent).toContain('Forbidden')
    );
    // The row is still there, and now the screen admits why.
    expect(rowText()).toHaveLength(1);
  });

  it('does not claim a sync started when the worker never took it', async () => {
    startEntraSyncMock.mockResolvedValue({
      success: true,
      data: { accepted: false, runId: null, error: 'Temporal client not available' },
    });

    renderTab([client()]);
    fireEvent.click(document.getElementById('entra-client-sync-managed-1') as HTMLButtonElement);

    await waitFor(() =>
      expect(document.getElementById('entra-clients-error')?.textContent).toContain('did not start')
    );
    expect(document.getElementById('entra-clients-message')).toBeNull();
  });
});

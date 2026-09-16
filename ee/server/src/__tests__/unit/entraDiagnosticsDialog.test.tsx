// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const GUID = '11111111-2222-3333-4444-555555555555';

const mocks = vi.hoisted(() => ({
  runConnection: vi.fn(),
  runClients: vi.fn(),
  getMappings: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  runEntraConnectionDiagnostics: mocks.runConnection,
  runEntraClientAccessDiagnostics: mocks.runClients,
  getEntraConfirmedMappings: mocks.getMappings,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/admin');
});

import { EntraDiagnosticsDialog } from '@ee/components/settings/integrations/entra/EntraDiagnosticsDialog';

const connectionReport = {
  createdAt: '2026-09-16T00:00:00.000Z',
  scope: 'connection' as const,
  summary: {
    connectionType: 'direct' as const,
    connectionStatus: 'connected',
    profileName: 'Partner App',
    partnerTenantId: GUID,
    authenticatedUpn: 'admin@partner.example',
    tokenExpiresAt: '2026-09-16T01:00:00.000Z',
    managedTenantCount: 2,
    mappedClientCount: 1,
    overallStatus: 'warn' as const,
  },
  steps: [
    {
      id: 'connection_row',
      title: 'Active Entra connection',
      status: 'pass' as const,
      startedAt: '2026-09-16T00:00:00.000Z',
      durationMs: 3,
      data: { status: 'connected' },
    },
    {
      id: 'token_refresh',
      title: 'Refresh the partner access token',
      status: 'fail' as const,
      startedAt: '2026-09-16T00:00:00.000Z',
      durationMs: 5,
      error: { message: 'grant expired', requestId: 'rid-1' },
    },
  ],
  clients: [],
  recommendations: [
    {
      code: 'refresh_token_invalid',
      severity: 'fail' as const,
      text: 'Reconnect Microsoft Entra to issue a new refresh token.',
      action: { kind: 'copy' as const, payload: 'reconnect' },
    },
  ],
  supportBundle: {
    createdAt: '2026-09-16T00:00:00.000Z',
    scope: 'connection',
    secrets: '<redacted>',
  },
};

describe('EntraDiagnosticsDialog', () => {
  beforeEach(() => {
    mocks.runConnection.mockReset();
    mocks.runClients.mockReset();
    mocks.getMappings.mockReset();
    mocks.getMappings.mockResolvedValue({ success: true, data: { mappings: [] } });
  });

  it('renders the overall badge, steps, and recommendations from a fixture', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Active Entra connection')).toBeTruthy();
    });
    expect(screen.getByText('Refresh the partner access token')).toBeTruthy();
    expect(screen.getByText(/Reconnect Microsoft Entra to issue a new refresh token/)).toBeTruthy();
  });

  it('shows client display names rather than GUIDs in the client table', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    mocks.getMappings.mockResolvedValue({
      success: true,
      data: {
        mappings: [
          {
            managedTenantId: 'managed-1',
            entraTenantId: GUID,
            clientId: 'client-1',
            clientName: 'Acme Corp',
            displayName: 'Acme Tenant',
            primaryDomain: 'acme.example',
            sourceUserCount: 3,
            userCount: 3,
            userCountSource: 'discovery',
            userCountObservedAt: null,
            lastSyncedAt: null,
            lastRunStatus: null,
          },
        ],
      },
    });
    mocks.runClients.mockResolvedValue({
      success: true,
      data: {
        jobId: '',
        scope: 'clients',
        total: 1,
        completed: 1,
        isDone: true,
        expiresAt: '2026-09-16T00:10:00.000Z',
        clients: [
          {
            clientId: 'client-1',
            clientName: 'Acme Corp',
            entraTenantId: GUID,
            entraTenantDisplayName: 'Acme Tenant',
            overallStatus: 'pass',
            category: 'ok',
            remedy: null,
            steps: [],
            isComplete: true,
          },
        ],
        aggregate: { ok: 1, need_consent: 0, conditional_access: 0, missing_role: 0, other: 0 },
        overallStatus: 'pass',
        steps: [],
        recommendations: [],
      },
    });

    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(document.getElementById('entra-diag-run-clients')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('entra-diag-run-clients') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeTruthy();
    });
    expect(screen.getByText('Acme Tenant')).toBeTruthy();
    // The GUID belongs in expanded details, not the visible row.
    expect(screen.queryByText(GUID)).toBeNull();
  });

  it('copies the redacted support bundle', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(document.getElementById('entra-diag-copy-bundle')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('entra-diag-copy-bundle') as HTMLElement);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    // Default export redacts identifiers; correlation ids survive.
    expect(copied).not.toContain(GUID);
    expect(copied).toContain('"generatedAt"');

    // The explicit include-identifiers control retains them.
    writeText.mockClear();
    fireEvent.click(document.getElementById('entra-diag-export-identifiers') as HTMLElement);
    fireEvent.click(document.getElementById('entra-diag-copy-bundle') as HTMLElement);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(writeText.mock.calls[0][0]).toContain(GUID);
  });

  it('defaults the picker to all mappings and disables the run button when cleared', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    mocks.getMappings.mockResolvedValue({
      success: true,
      data: {
        mappings: [
          mappingFixture('c1', 'Client One'),
          mappingFixture('c2', 'Client Two'),
        ],
      },
    });
    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(document.getElementById('entra-diag-client-c1')).toBeTruthy();
    });
    expect((document.getElementById('entra-diag-client-c1') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('entra-diag-client-c2') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(document.getElementById('entra-diag-clear') as HTMLElement);
    await waitFor(() => {
      expect((document.getElementById('entra-diag-run-clients') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('requires confirmation above 20 selected clients', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    mocks.getMappings.mockResolvedValue({
      success: true,
      data: {
        mappings: Array.from({ length: 21 }, (_, i) => mappingFixture(`c${i}`, `Client ${i}`)),
      },
    });
    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(document.getElementById('entra-diag-run-clients')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('entra-diag-run-clients') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Run diagnostics for many clients?')).toBeTruthy();
    });
    expect(mocks.runClients).not.toHaveBeenCalled();
  });

  it('folds multiple continuation batches and marks an incomplete client partial', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    mocks.getMappings.mockResolvedValue({
      success: true,
      data: { mappings: [mappingFixture('c1', 'Client One'), mappingFixture('c2', 'Client Two')] },
    });
    mocks.runClients
      .mockResolvedValueOnce({
        success: true,
        data: {
          jobId: 'job-1',
          scope: 'clients',
          total: 2,
          completed: 1,
          isDone: false,
          expiresAt: '2026-09-16T00:10:00.000Z',
          clients: [clientFixture('c1', 'Client One', true)],
          aggregate: { ok: 1, need_consent: 0, conditional_access: 0, missing_role: 0, other: 0 },
          overallStatus: 'pass',
          steps: [],
          recommendations: [],
          startedAt: '2026-09-16T00:00:00.000Z',
          completedAt: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          jobId: '',
          scope: 'clients',
          total: 2,
          completed: 2,
          isDone: true,
          expiresAt: '2026-09-16T00:10:00.000Z',
          clients: [clientFixture('c2', 'Client Two', false)],
          aggregate: { ok: 1, need_consent: 0, conditional_access: 0, missing_role: 0, other: 1 },
          overallStatus: 'warn',
          steps: [],
          recommendations: [],
          startedAt: '2026-09-16T00:00:00.000Z',
          completedAt: '2026-09-16T00:01:00.000Z',
        },
      });

    render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);
    await waitFor(() => {
      expect(document.getElementById('entra-diag-run-clients')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('entra-diag-run-clients') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Client One')).toBeTruthy();
      expect(screen.getByText('Client Two')).toBeTruthy();
    });
    expect(mocks.runClients).toHaveBeenCalledTimes(2);
    // The incomplete client is labelled partial, not green.
    expect(screen.getByText('Partial')).toBeTruthy();
  });

  it('clears prior client results when the dialog is reopened', async () => {
    mocks.runConnection.mockResolvedValue({ success: true, data: connectionReport });
    mocks.getMappings.mockResolvedValue({
      success: true,
      data: { mappings: [mappingFixture('c1', 'Client One')] },
    });
    mocks.runClients.mockResolvedValue({
      success: true,
      data: {
        jobId: '',
        scope: 'clients',
        total: 1,
        completed: 1,
        isDone: true,
        expiresAt: '2026-09-16T00:10:00.000Z',
        clients: [clientFixture('c1', 'Client One', true)],
        aggregate: { ok: 1, need_consent: 0, conditional_access: 0, missing_role: 0, other: 0 },
        overallStatus: 'pass',
        steps: [],
        recommendations: [],
        startedAt: '2026-09-16T00:00:00.000Z',
        completedAt: '2026-09-16T00:01:00.000Z',
      },
    });

    const view = render(<EntraDiagnosticsDialog isOpen onClose={() => {}} />);
    await waitFor(() => {
      expect(document.getElementById('entra-diag-run-clients')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('entra-diag-run-clients') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('Client One')).toBeTruthy();
    });

    view.rerender(<EntraDiagnosticsDialog isOpen={false} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('Client One')).toBeNull();
    });
  });
});

function mappingFixture(clientId: string, clientName: string) {
  return {
    managedTenantId: `managed-${clientId}`,
    entraTenantId: `entra-${clientId}`,
    clientId,
    clientName,
    displayName: `${clientName} Tenant`,
    primaryDomain: `${clientId}.example`,
    sourceUserCount: 1,
    userCount: 1,
    userCountSource: 'discovery',
    userCountObservedAt: null,
    lastSyncedAt: null,
    lastRunStatus: null,
  };
}

function clientFixture(clientId: string, clientName: string, isComplete: boolean) {
  return {
    clientId,
    clientName,
    entraTenantId: `entra-${clientId}`,
    entraTenantDisplayName: `${clientName} Tenant`,
    overallStatus: 'pass',
    category: 'ok',
    remedy: null,
    steps: [],
    isComplete,
  };
}

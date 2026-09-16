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
    expect(copied).toContain('<redacted>');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraIntegrationSettings from '@ee/components/settings/integrations/EntraIntegrationSettings';

const {
  useFeatureFlagMock,
  getEntraIntegrationStatusMock,
  getEntraSyncRunHistoryMock,
  discoverEntraManagedTenantsMock,
  startEntraSyncMock,
  initiateEntraDirectOAuthMock,
  disconnectEntraIntegrationMock,
  unmapEntraTenantMock,
  mappingTableState,
} = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  getEntraIntegrationStatusMock: vi.fn(),
  getEntraSyncRunHistoryMock: vi.fn(),
  discoverEntraManagedTenantsMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
  initiateEntraDirectOAuthMock: vi.fn(),
  disconnectEntraIntegrationMock: vi.fn(),
  unmapEntraTenantMock: vi.fn(),
  mappingTableState: {
    summary: { mapped: 0, skipped: 0, needsReview: 0 },
    skippedTenants: [] as Array<{
      managedTenantId: string;
      displayName: string | null;
      primaryDomain: string | null;
    }>,
  },
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraIntegrationStatus: getEntraIntegrationStatusMock,
  getEntraSyncRunHistory: getEntraSyncRunHistoryMock,
  discoverEntraManagedTenants: discoverEntraManagedTenantsMock,
  startEntraSync: startEntraSyncMock,
  initiateEntraDirectOAuth: initiateEntraDirectOAuthMock,
  disconnectEntraIntegration: disconnectEntraIntegrationMock,
  unmapEntraTenant: unmapEntraTenantMock,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock(
  '@ee/components/settings/integrations/EntraTenantMappingTable',
  () => ({
    EntraTenantMappingTable: (props: {
      onSummaryChange?: (summary: { mapped: number; skipped: number; needsReview: number }) => void;
      onSkippedTenantsChange?: (
        rows: Array<{ managedTenantId: string; displayName: string | null; primaryDomain: string | null }>
      ) => void;
    }) => {
      React.useEffect(() => {
        props.onSummaryChange?.(mappingTableState.summary);
        props.onSkippedTenantsChange?.(mappingTableState.skippedTenants);
      }, [props]);
      return <div id="entra-tenant-mapping-table-stub" />;
    },
  })
);

vi.mock('@ee/components/settings/integrations/EntraSyncHistoryPanel', () => ({
  default: () => <div id="entra-sync-history-panel-stub" />,
}));

vi.mock('@ee/components/settings/integrations/EntraReconciliationQueue', () => ({
  default: () => <div id="entra-reconciliation-queue-stub" />,
}));

const buildStatus = (overrides: Record<string, unknown> = {}) => ({
  status: 'connected',
  connectionType: 'direct',
  lastDiscoveryAt: null,
  mappedTenantCount: 0,
  nextSyncIntervalMinutes: null,
  availableConnectionTypes: ['direct', 'cipp'],
  lastValidatedAt: null,
  lastValidationError: null,
  ...overrides,
});

const applyFlags = (enabledFlags: string[]) => {
  useFeatureFlagMock.mockImplementation((name: string) => ({
    enabled: enabledFlags.includes(name),
  }));
};

describe('EntraIntegrationSettings guided flow', () => {
  beforeEach(() => {
    useFeatureFlagMock.mockReset();
    getEntraIntegrationStatusMock.mockReset();
    getEntraSyncRunHistoryMock.mockReset();
    discoverEntraManagedTenantsMock.mockReset();
    startEntraSyncMock.mockReset();
    initiateEntraDirectOAuthMock.mockReset();
    disconnectEntraIntegrationMock.mockReset();
    unmapEntraTenantMock.mockReset();

    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];

    applyFlags(['entra-integration-ui']);
    getEntraSyncRunHistoryMock.mockResolvedValue({ success: true, data: { runs: [] } });
    discoverEntraManagedTenantsMock.mockResolvedValue({
      success: true,
      data: {
        discoveredTenantCount: 2,
        discoveredTenants: [],
      },
    });
    startEntraSyncMock.mockResolvedValue({ success: true, data: { runId: 'run-123' } });
    initiateEntraDirectOAuthMock.mockResolvedValue({ success: true, data: { authUrl: '/auth' } });
    disconnectEntraIntegrationMock.mockResolvedValue({ success: true, data: { status: 'disconnected' } });
    unmapEntraTenantMock.mockResolvedValue({ success: true, data: {} });
  });

  it('T002: not-connected state keeps Connect as current and hides discovery/sync CTAs', async () => {
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({ status: 'not_connected', connectionType: null }),
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Current Step');
    expect(screen.getByText('Step 1: Connect')).toBeInTheDocument();

    expect(document.getElementById('entra-step-1')?.textContent).toContain('current');
    expect(document.getElementById('entra-step-2')?.textContent).toContain('locked');
    expect(screen.getByText('Direct Microsoft Partner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Discovery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Initial Sync' })).not.toBeInTheDocument();
  });

  it('T003: connected-without-discovery state runs discovery from guided CTA', async () => {
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: null,
        mappedTenantCount: 0,
      }),
    });

    render(<EntraIntegrationSettings />);

    const discoveryButton = await screen.findByRole('button', { name: 'Run Discovery' });
    expect(screen.getByText('Step 2: Discover')).toBeInTheDocument();
    fireEvent.click(discoveryButton);

    expect(discoverEntraManagedTenantsMock).toHaveBeenCalledTimes(1);
    await screen.findByText('Discovery completed. 2 tenants discovered.');
  });

  it('T004: discovered-without-mapped-tenants state emphasizes mapping step guidance', async () => {
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: '2026-02-20T12:00:00.000Z',
        mappedTenantCount: 0,
      }),
    });
    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 2 };

    render(<EntraIntegrationSettings />);

    await screen.findByText('Step 3: Map');
    expect(screen.getByRole('button', { name: 'Review Mappings' })).toBeInTheDocument();
    expect(document.getElementById('entra-mapping-step-panel')?.textContent).toContain('This is your current onboarding step.');
  });

  it('T005: mapped-tenant state runs initial sync from guided CTA', async () => {
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: '2026-02-20T12:00:00.000Z',
        mappedTenantCount: 2,
      }),
    });
    mappingTableState.summary = { mapped: 2, skipped: 0, needsReview: 0 };

    render(<EntraIntegrationSettings />);

    const initialSyncButton = await screen.findByRole('button', { name: 'Run Initial Sync' });
    fireEvent.click(initialSyncButton);

    expect(startEntraSyncMock).toHaveBeenCalledWith({ scope: 'initial' });
    await screen.findByText('Initial sync started. Run ID: run-123');
  });

  it('T121: status panel shows connection, discovery, mapping count, and sync interval details', async () => {
    mappingTableState.summary = { mapped: 7, skipped: 1, needsReview: 0 };
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        connectionType: 'cipp',
        mappedTenantCount: 7,
        nextSyncIntervalMinutes: 30,
        connectionDetails: {
          cippBaseUrl: 'https://cipp.example.com',
          directTenantId: null,
          directCredentialSource: null,
        },
      }),
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Status');
    const panel = document.getElementById('entra-connection-status-panel');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Connection: connected');
    expect(panel?.textContent).toContain('Connection Type: cipp');
    expect(panel?.textContent).toContain('CIPP Server: https://cipp.example.com');
    expect(panel?.textContent).toContain('Mapped Tenants: 7');
    expect(panel?.textContent).toContain('Next Sync Interval: Every 30 minutes');
  });

  it('T132: status panel shows direct Microsoft tenant and credential source details', async () => {
    mappingTableState.summary = { mapped: 1, skipped: 0, needsReview: 0 };
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        connectionType: 'direct',
        mappedTenantCount: 1,
        nextSyncIntervalMinutes: 60,
        connectionDetails: {
          cippBaseUrl: null,
          directTenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          directCredentialSource: 'tenant-secret',
        },
      }),
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Status');
    const panel = document.getElementById('entra-connection-status-panel');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Connection Type: direct');
    expect(panel?.textContent).toContain('Microsoft Tenant: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(panel?.textContent).toContain('Credential Source: tenant-secret');
  });

  it('T124: Sync All Tenants Now button is disabled when there are no active mappings', async () => {
    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 0 };
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        mappedTenantCount: 0,
      }),
    });

    render(<EntraIntegrationSettings />);

    const syncAllButton = await screen.findByRole('button', { name: 'Sync All Tenants Now' });
    expect(syncAllButton).toBeDisabled();
  });

  it('T125: Sync All Tenants Now button is enabled when active mappings exist', async () => {
    mappingTableState.summary = { mapped: 2, skipped: 0, needsReview: 0 };
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: '2026-02-20T12:00:00.000Z',
        mappedTenantCount: 2,
      }),
    });

    render(<EntraIntegrationSettings />);

    const syncAllButton = await screen.findByRole('button', { name: 'Sync All Tenants Now' });
    expect(syncAllButton).toBeEnabled();
  });

  it('T068: mapping wizard content is inaccessible when the Entra UI flag is disabled', async () => {
    applyFlags([]);
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: null,
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Entra integration UI is currently disabled for this tenant.');
    expect(screen.queryByText('Map Tenants to Clients')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Initial Sync' })).not.toBeInTheDocument();
  });

  it('T128: ambiguous reconciliation queue panel is hidden when flag is disabled', async () => {
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: '2026-02-20T12:00:00.000Z',
        mappedTenantCount: 1,
      }),
    });

    render(<EntraIntegrationSettings />);
    await screen.findByText('Current Step');
    expect(document.getElementById('entra-reconciliation-queue-stub')).toBeNull();
  });

  it('T129: ambiguous reconciliation queue panel is visible when flag is enabled', async () => {
    applyFlags(['entra-integration-ui', 'entra-integration-ambiguous-queue']);
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: buildStatus({
        status: 'connected',
        lastDiscoveryAt: '2026-02-20T12:00:00.000Z',
        mappedTenantCount: 1,
      }),
    });

    render(<EntraIntegrationSettings />);
    await screen.findByText('Current Step');
    expect(document.getElementById('entra-reconciliation-queue-stub')).not.toBeNull();
  });
});

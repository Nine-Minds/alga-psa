// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EntraIntegrationSettings from '@ee/components/settings/integrations/EntraIntegrationSettings';

const {
  useFeatureFlagMock,
  getEntraIntegrationStatusMock,
  startEntraSyncMock,
  mappingTableState,
} = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  getEntraIntegrationStatusMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
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
  startEntraSync: startEntraSyncMock,
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

describe('EntraIntegrationSettings initial sync CTA', () => {
  it('T066: Run Initial Sync is disabled when there are zero confirmed mappings', async () => {
    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 0,
        nextSyncIntervalMinutes: null,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });
    startEntraSyncMock.mockResolvedValue({ success: true, data: { runId: 'run-66' } });

    render(<EntraIntegrationSettings />);

    const initialSyncButton = await screen.findByRole('button', { name: 'Run Initial Sync' });
    expect(initialSyncButton).toBeDisabled();
  });

  it('T067: skipped tenants panel renders skipped entries and exposes remap controls', async () => {
    mappingTableState.summary = { mapped: 1, skipped: 2, needsReview: 0 };
    mappingTableState.skippedTenants = [
      {
        managedTenantId: 'managed-skipped-1',
        displayName: 'Skipped Tenant One',
        primaryDomain: 'one.skipped.example.com',
      },
      {
        managedTenantId: 'managed-skipped-2',
        displayName: 'Skipped Tenant Two',
        primaryDomain: null,
      },
    ];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 1,
        nextSyncIntervalMinutes: null,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Skipped Tenant One');
    await screen.findByText('Skipped Tenant Two');
    expect(screen.getAllByRole('button', { name: 'Remap' })).toHaveLength(2);
  });

  it('T068: mapping wizard content is inaccessible when the Entra UI flag is disabled', async () => {
    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockReturnValue({ enabled: false });
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: null,
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Entra integration UI is currently disabled for this tenant.');
    expect(screen.queryByText('Map Tenants to Clients')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Initial Sync' })).not.toBeInTheDocument();
  });

  it('T121: settings status panel shows connection, discovery, mapping count, and sync interval details', async () => {
    mappingTableState.summary = { mapped: 7, skipped: 1, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'cipp',
        lastDiscoveryAt: null,
        mappedTenantCount: 7,
        nextSyncIntervalMinutes: 30,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    await screen.findByText('Status');
    const panel = document.getElementById('entra-connection-status-panel');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Connection: connected');
    expect(panel?.textContent).toContain('Connection Type: cipp');
    expect(panel?.textContent).toContain('Last Discovery: Never');
    expect(panel?.textContent).toContain('Mapped Tenants: 7');
    expect(panel?.textContent).toContain('Next Sync Interval: Every 30 minutes');
  });

  it('T124: Sync All Tenants Now button is disabled when there are no active mappings', async () => {
    mappingTableState.summary = { mapped: 0, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 0,
        nextSyncIntervalMinutes: 60,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    const syncAllButton = await screen.findByRole('button', { name: 'Sync All Tenants Now' });
    expect(syncAllButton).toBeDisabled();
  });

  it('T125: Sync All Tenants Now button is enabled when active mappings exist', async () => {
    mappingTableState.summary = { mapped: 2, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 2,
        nextSyncIntervalMinutes: 60,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    const syncAllButton = await screen.findByRole('button', { name: 'Sync All Tenants Now' });
    expect(syncAllButton).toBeEnabled();
  });

  it('T128: ambiguous reconciliation queue panel is hidden when flag is disabled', async () => {
    mappingTableState.summary = { mapped: 1, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 1,
        nextSyncIntervalMinutes: null,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    await screen.findByRole('button', { name: 'Run Initial Sync' });
    expect(document.getElementById('entra-reconciliation-queue-stub')).toBeNull();
  });

  it('T129: ambiguous reconciliation queue panel is visible when flag is enabled', async () => {
    mappingTableState.summary = { mapped: 1, skipped: 0, needsReview: 0 };
    mappingTableState.skippedTenants = [];
    useFeatureFlagMock.mockImplementation((name: string) => ({
      enabled: name === 'entra-integration-ui' || name === 'entra-integration-ambiguous-queue',
    }));
    getEntraIntegrationStatusMock.mockResolvedValue({
      success: true,
      data: {
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: null,
        mappedTenantCount: 1,
        nextSyncIntervalMinutes: null,
        availableConnectionTypes: ['direct', 'cipp'],
        lastValidatedAt: null,
        lastValidationError: null,
      },
    });

    render(<EntraIntegrationSettings />);

    await screen.findByRole('button', { name: 'Run Initial Sync' });
    expect(document.getElementById('entra-reconciliation-queue-stub')).not.toBeNull();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EntraIntegrationSettings from '@ee/components/settings/integrations/EntraIntegrationSettings';

const {
  useFeatureFlagMock,
  getEntraIntegrationStatusMock,
  startEntraSyncMock,
} = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  getEntraIntegrationStatusMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
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
    EntraTenantMappingTable: () => <div id="entra-tenant-mapping-table-stub" />,
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
});

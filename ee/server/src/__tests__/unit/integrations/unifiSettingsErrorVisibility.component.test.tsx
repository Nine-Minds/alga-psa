// @vitest-environment jsdom
/**
 * UniFi settings: a handler's error/warning must survive the background
 * refresh(true) that runs right after it (deploy-fix blocker 2).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UniFiIntegrationSettings from '@ee/components/settings/integrations/UniFiIntegrationSettings';

const m = vi.hoisted(() => ({
  getUniFiSettings: vi.fn(),
  listUniFiSiteMappings: vi.fn(),
  getUniFiConnectionSummary: vi.fn(),
  testUniFiConnection: vi.fn(),
  runUniFiAlertCheckNow: vi.fn(),
}));

vi.mock('@ee/lib/actions/integrations/uniFiActions', () => ({
  disconnectUniFiIntegration: vi.fn(),
  getUniFiConnectionSummary: m.getUniFiConnectionSummary,
  getUniFiSettings: m.getUniFiSettings,
  listUniFiSiteMappings: m.listUniFiSiteMappings,
  saveUniFiConfiguration: vi.fn(),
  syncUniFiSites: vi.fn(),
  triggerUniFiFullSync: vi.fn(),
  saveUniFiAlertingSettings: vi.fn(),
  runUniFiAlertCheckNow: m.runUniFiAlertCheckNow,
  testUniFiConnection: m.testUniFiConnection,
  updateUniFiSiteMapping: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: vi.fn().mockResolvedValue([]),
  getAllContacts: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui/context', () => ({ useQuickAddClient: () => ({ renderQuickAddContact: () => null }) }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, variant: _v, ...props }: any) => <button id={id} {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmAlertAutomationSettings', () => ({
  RmmAlertAutomationSettings: () => null,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmDeviceSyncSettings', () => ({
  RmmDeviceSyncSettings: () => null,
}));

describe('UniFiIntegrationSettings error visibility across background refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getUniFiSettings.mockResolvedValue({
      success: true,
      config: { integrationId: 'i1', isActive: true, syncStatus: 'completed' },
      credentials: { hasApiKey: true },
    });
    m.listUniFiSiteMappings.mockResolvedValue({ success: true, mappings: [] });
    m.getUniFiConnectionSummary.mockResolvedValue({
      success: true,
      summary: { mappedSites: 0, devices: 0, activeAlerts: 0 },
    });
  });

  it('keeps a failed Test Connection error visible after refresh(true)', async () => {
    m.testUniFiConnection.mockResolvedValue({ success: false, error: 'Console unreachable' });
    const { container } = render(<UniFiIntegrationSettings />);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('#unifi-test-connection')?.disabled).toBe(false));
    const callsBefore = m.getUniFiSettings.mock.calls.length;

    fireEvent.click(container.querySelector('#unifi-test-connection')!);

    await waitFor(() => expect(m.getUniFiSettings.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.getByText('Console unreachable')).toBeTruthy());
  });

  it('keeps Check Offline Devices Now warnings and success visible after refresh(true)', async () => {
    m.runUniFiAlertCheckNow.mockResolvedValue({ success: true, warnings: ['site A: listing empty'] });
    const { container } = render(<UniFiIntegrationSettings />);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('#unifi-check-offline-now')?.disabled).toBe(false));
    const callsBefore = m.getUniFiSettings.mock.calls.length;

    fireEvent.click(container.querySelector('#unifi-check-offline-now')!);

    await waitFor(() => expect(m.getUniFiSettings.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.getByText('site A: listing empty')).toBeTruthy());
    expect(screen.getByText('Offline check completed')).toBeTruthy();
  });
});

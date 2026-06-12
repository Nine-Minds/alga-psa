/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsAppPackageStatusMock = vi.hoisted(() => vi.fn());
const saveTeamsIntegrationSettingsMock = vi.hoisted(() => vi.fn());
const runTeamsDiagnosticsMock = vi.hoisted(() => vi.fn());
const sendTeamsTestMessageMock = vi.hoisted(() => vi.fn());

vi.mock('../../../actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  getTeamsIntegrationStatus: (...args: unknown[]) => getTeamsIntegrationStatusMock(...args),
  getTeamsAppPackageStatus: (...args: unknown[]) => getTeamsAppPackageStatusMock(...args),
  saveTeamsIntegrationSettings: (...args: unknown[]) => saveTeamsIntegrationSettingsMock(...args),
  runTeamsDiagnostics: (...args: unknown[]) => runTeamsDiagnosticsMock(...args),
  sendTeamsTestMessage: (...args: unknown[]) => sendTeamsTestMessageMock(...args),
}));

import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';

function microsoftStatus() {
  return {
    success: true,
    baseUrl: 'https://psa.example.com',
    redirectUris: {
      teamsTab: 'https://psa.example.com/api/teams/auth/callback/tab',
      teamsBot: 'https://psa.example.com/api/teams/auth/callback/bot',
      teamsMessageExtension: 'https://psa.example.com/api/teams/auth/callback/message-extension',
    },
    scopes: {
      teams: ['openid', 'profile', 'offline_access'],
    },
    profiles: [
      {
        profileId: 'profile-1',
        displayName: 'Primary Profile',
        clientId: 'client-1',
        isArchived: false,
        readiness: {
          ready: true,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: true,
        },
      },
    ],
  };
}

function teamsStatus(installStatus = 'active') {
  return {
    success: true,
    integration: {
      selectedProfileId: 'profile-1',
      installStatus,
      enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
      notificationCategories: ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'],
      allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
      appId: 'teams-app-1',
      botId: 'teams-bot-1',
      packageMetadata: { baseUrl: 'https://psa.example.com' },
      lastError: null,
    },
  };
}

function diagnosticsReport(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: '2026-05-29T12:00:00.000Z',
    overallStatus: 'warn',
    recommendations: ['Open the Alga PSA bot in Teams and send it any message first, then retry.'],
    steps: [
      {
        id: 'addon_entitlement',
        title: 'Teams add-on entitlement',
        status: 'pass',
        detail: 'Teams add-on is active.',
        durationMs: 1,
      },
      {
        id: 'conversation_reference',
        title: 'Admin Teams conversation reference',
        status: 'warn',
        detail: 'Open the Alga PSA bot in Teams and send it any message first, then retry.',
        durationMs: 1,
      },
      {
        id: 'recent_delivery_health',
        title: 'Recent Teams delivery health',
        status: 'warn',
        detail: 'Most recent Teams delivery failed: network timeout.',
        durationMs: 1,
        data: {
          lastSuccess: {
            deliveryId: 'delivery-success',
            status: 'sent',
            createdAt: '2026-05-29T11:00:00.000Z',
          },
          lastFailure: {
            deliveryId: 'delivery-failure',
            status: 'failed',
            errorMessage: 'network timeout',
            createdAt: '2026-05-29T11:05:00.000Z',
          },
        },
      },
    ],
    ...overrides,
  };
}

async function renderSettings() {
  render(<TeamsIntegrationSettings />);
  await waitFor(() => expect(screen.getByText('Diagnostics & Test Message')).toBeInTheDocument());
}

describe('TeamsIntegrationSettings diagnostics panel', () => {
  beforeEach(() => {
    getMicrosoftIntegrationStatusMock.mockResolvedValue(microsoftStatus());
    getTeamsIntegrationStatusMock.mockResolvedValue(teamsStatus());
    getTeamsAppPackageStatusMock.mockResolvedValue({ success: true, package: null });
    saveTeamsIntegrationSettingsMock.mockResolvedValue(teamsStatus());
    runTeamsDiagnosticsMock.mockResolvedValue(diagnosticsReport());
    sendTeamsTestMessageMock.mockResolvedValue({
      status: 'sent',
      detail: 'Teams test message sent.',
      deliveryId: 'delivery-1',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders diagnostics steps with status badges after running diagnostics', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Run diagnostics/i }));

    expect(await screen.findByText('Teams add-on entitlement')).toBeInTheDocument();
    expect(screen.getByText('Admin Teams conversation reference')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getAllByText('Warn').length).toBeGreaterThan(0);
  });

  it('renders recommendations only when present', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Run diagnostics/i }));
    expect(await screen.findByText('Recommendations')).toBeInTheDocument();
    expect(screen.getAllByText('Open the Alga PSA bot in Teams and send it any message first, then retry.').length).toBeGreaterThan(0);

    cleanup();
    runTeamsDiagnosticsMock.mockResolvedValueOnce(diagnosticsReport({ recommendations: [] }));
    await renderSettings();
    await user.click(screen.getByRole('button', { name: /Run diagnostics/i }));
    await screen.findByText('Teams add-on entitlement');
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
  });

  it('shows a success confirmation after sending a test message', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Send test message/i }));

    expect(await screen.findByText('Teams test message sent.')).toBeInTheDocument();
  });

  it('maps missing_conversation_reference to bot-first guidance', async () => {
    const user = userEvent.setup();
    sendTeamsTestMessageMock.mockResolvedValueOnce({
      status: 'skipped',
      reason: 'missing_conversation_reference',
      detail: 'Open the Alga PSA bot in Teams and send it any message first, then retry.',
      deliveryId: 'delivery-1',
    });
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Send test message/i }));

    expect(await screen.findByText('Open the Alga PSA bot in Teams and send it any message first, then retry.')).toBeInTheDocument();
  });

  it('disables diagnostics and test message buttons when the integration is inactive or unavailable', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue(teamsStatus('install_pending'));
    await renderSettings();

    expect(screen.getByRole('button', { name: /Run diagnostics/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send test message/i })).toBeDisabled();

    cleanup();
    getTeamsIntegrationStatusMock.mockResolvedValue({ success: false, error: 'Teams add-on required' });
    await renderSettings();
    expect(screen.getByRole('button', { name: /Run diagnostics/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send test message/i })).toBeDisabled();
  });

  it('renders recent delivery summary from diagnostics data', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Run diagnostics/i }));

    await screen.findByText('Last failure');
    expect(screen.getByText('Last success')).toBeInTheDocument();
    expect(screen.getAllByText(/network timeout/).length).toBeGreaterThan(0);
  });
});

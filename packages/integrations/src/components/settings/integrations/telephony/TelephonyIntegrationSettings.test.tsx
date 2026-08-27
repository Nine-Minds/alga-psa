// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TelephonyOverview } from '../../../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  setProviderEnabled: vi.fn(async () => ({ success: true })),
  setAutoTicketPolicy: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../../actions/integrations/telephonyActions', () => ({
  getTelephonyOverview: mocks.getOverview,
  setTelephonyProviderEnabled: mocks.setProviderEnabled,
  setTelephonyAutoTicketPolicy: mocks.setAutoTicketPolicy,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }), useFormatters: () => ({ locale: 'en' }) };
});

import { TelephonyIntegrationSettings } from './TelephonyIntegrationSettings';

function overview(overrides: Partial<TelephonyOverview> = {}): TelephonyOverview {
  return {
    success: true,
    available: true,
    canManage: true,
    canResolve: true,
    providers: [
      {
        provider: 'teams-phone',
        status: 'active',
        autoCreateTickets: false,
        subscriptionId: 'sub-1',
        subscriptionExpiresAt: '2026-08-25T00:00:00.000Z',
        lastError: null,
        lastNotificationAt: null,
        prerequisiteMet: true,
      },
    ],
    recentCalls: [],
    unresolvedCalls: [],
    ...overrides,
  };
}

describe('TelephonyIntegrationSettings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('T007: renders the Teams Phone provider card with its current status', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Teams Phone')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
  });

  it('T007: an unconfigured provider explains the Teams prerequisite', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [{
        provider: 'teams-phone',
        status: 'not_configured',
        autoCreateTickets: false,
        subscriptionId: null,
        subscriptionExpiresAt: null,
        lastError: null,
        lastNotificationAt: null,
        prerequisiteMet: false,
      }],
    }));

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/Configure the Microsoft Teams integration first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable' }).hasAttribute('disabled')).toBe(true);
  });

  it('T007: the card reports when Graph last delivered a call notification', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [{
        provider: 'teams-phone',
        status: 'active',
        autoCreateTickets: false,
        subscriptionId: 'sub-1',
        subscriptionExpiresAt: null,
        lastError: null,
        lastNotificationAt: '2026-08-22T15:04:00.000Z',
        prerequisiteMet: true,
      }],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    await screen.findByText('Teams Phone');
    // A silent subscription and a quiet phone look identical without this.
    expect(container.querySelector('#telephony-provider-last-notification-teams-phone')?.textContent)
      .toContain('Last call notification');
  });

  it('T008: a tenant without the add-on gets the paywall and no provider controls', async () => {
    mocks.getOverview.mockResolvedValue({
      success: true,
      available: false,
      reason: 'addon_required',
      error: 'Microsoft Teams add-on required',
      canManage: true,
      canResolve: true,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    });

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Microsoft Teams add-on')).toBeTruthy();
    expect(screen.queryByText('Teams Phone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
  });

  it('T044: a refused caller is told so, not sent to buy an add-on', async () => {
    mocks.getOverview.mockResolvedValue({
      success: false,
      error: 'Forbidden',
      available: false,
      canManage: false,
      canResolve: false,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    });

    const { container } = render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText(/do not have permission/i)).toBeTruthy();
    expect(container.querySelector('#telephony-paywall-card')).toBeNull();
    expect(screen.queryByText('Teams Phone')).toBeNull();
  });

  it('keeps operational call lists out of the provider settings page', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Teams Phone')).toBeTruthy();
    expect(screen.queryByText('Recent calls')).toBeNull();
    expect(screen.queryByText('Calls needing attribution')).toBeNull();
  });

  it('T011: the interactive elements carry kebab-case reflection ids', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    await screen.findByText('Teams Phone');
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining([
      'telephony-integrations-setup',
      'telephony-provider-card-teams-phone',
    ]));
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });
});

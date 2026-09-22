// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TelephonyOverview } from '../../../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  setProviderEnabled: vi.fn(async () => ({ success: true })),
  setAutoTicketPolicy: vi.fn(async () => ({ success: true })),
  searchParams: {} as Record<string, string>,
  flagEnabled: true,
}));

vi.mock('../../../../actions/integrations/telephonyActions', () => ({
  getTelephonyOverview: mocks.getOverview,
  setTelephonyProviderEnabled: mocks.setProviderEnabled,
  setTelephonyAutoTicketPolicy: mocks.setAutoTicketPolicy,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => mocks.searchParams[key] ?? null }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: mocks.flagEnabled, loading: false, error: null }),
}));

vi.mock('@alga-psa/core/features', () => ({ RELEASE_V1_6_FEATURE_FLAG: 'release-v1-6-feature' }));

// The 3CX panel loads its own state through server actions; the chooser test
// only cares that selecting the card mounts it.
vi.mock('./ThreecxIntegrationSettings', () => ({
  ThreecxIntegrationSettings: () => <div id="threecx-integration-settings" />,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }), useFormatters: () => ({ locale: 'en' }) };
});

import { TelephonyIntegrationSettings } from './TelephonyIntegrationSettings';

function teamsPhone(overrides: Partial<TelephonyOverview['providers'][number]> = {}) {
  return {
    provider: 'teams-phone',
    status: 'active' as const,
    autoCreateTickets: false,
    subscriptionId: 'sub-1',
    subscriptionExpiresAt: '2026-08-25T00:00:00.000Z',
    lastError: null,
    lastNotificationAt: null,
    prerequisiteMet: true,
    ...overrides,
  };
}

function overview(overrides: Partial<TelephonyOverview> = {}): TelephonyOverview {
  return {
    success: true,
    available: true,
    canManage: true,
    canResolve: true,
    providers: [teamsPhone()],
    recentCalls: [],
    unresolvedCalls: [],
    ...overrides,
  };
}

/**
 * Open a provider's settings page the way an operator does: from the chooser.
 * The package test setup stubs the UI reflection hook, so Button ids never
 * reach the DOM here — the source scan below guards those instead.
 */
async function configure() {
  fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
}

describe('TelephonyIntegrationSettings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.searchParams = {};
    mocks.flagEnabled = true;
    window.history.pushState({}, '', '/msp/settings?category=communication');
  });

  it('T007: the chooser lists each provider as a compact card with its current status', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Teams Phone')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(container.querySelector('#telephony-provider-card-teams-phone')).toBeTruthy();
    // The on/off control belongs to the settings page, not the chooser card.
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });

  it('T007: choosing a provider opens its full-width settings page', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    await configure();

    await waitFor(() => expect(container.querySelector('#teams-phone-integration-settings')).toBeTruthy());
    expect(container.querySelector('#telephony-provider-card-teams-phone')).toBeNull();
    expect(container.querySelector('#telephony-integration-current-provider')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
    // The selection is mirrored into the URL so the page can be linked to.
    expect(window.location.search).toContain('telephony_provider=teams-phone');
  });

  it('T007: Choose another returns to the provider cards', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    await configure();
    await waitFor(() => expect(container.querySelector('#teams-phone-integration-settings')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));

    await waitFor(() => expect(container.querySelector('#telephony-provider-card-teams-phone')).toBeTruthy());
    expect(container.querySelector('#teams-phone-integration-settings')).toBeNull();
  });

  it('T007: a telephony_provider URL param opens that provider straight away', async () => {
    mocks.searchParams = { telephony_provider: 'teams-phone' };
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    await waitFor(() => expect(container.querySelector('#teams-phone-integration-settings')).toBeTruthy());
    expect(container.querySelector('#telephony-provider-card-teams-phone')).toBeNull();
  });

  it('T007: a threecxPending deep link opens the 3CX page so its dialog can show', async () => {
    mocks.searchParams = { threecxPending: 'pending-1' };
    mocks.getOverview.mockResolvedValue(overview({
      providers: [teamsPhone(), {
        provider: '3cx',
        status: 'active',
        autoCreateTickets: false,
        subscriptionId: null,
        subscriptionExpiresAt: null,
        lastError: null,
        lastNotificationAt: null,
        prerequisiteMet: true,
        providerAvailability: { enabled: true, reason: 'enabled' },
      }],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    await waitFor(() => expect(container.querySelector('#threecx-integration-settings')).toBeTruthy());
  });

  it('T105: the 3CX card stays out of the chooser without the release flag or the tier', async () => {
    const threecx = {
      provider: '3cx',
      status: 'not_configured' as const,
      autoCreateTickets: false,
      subscriptionId: null,
      subscriptionExpiresAt: null,
      lastError: null,
      lastNotificationAt: null,
      prerequisiteMet: true,
      providerAvailability: { enabled: true, reason: 'enabled' },
    };
    mocks.getOverview.mockResolvedValue(overview({ providers: [teamsPhone(), threecx] }));

    const { container } = render(<TelephonyIntegrationSettings />);
    await waitFor(() => expect(container.querySelector('#telephony-provider-card-3cx')).toBeTruthy());

    cleanup();
    mocks.flagEnabled = false;
    const flagOff = render(<TelephonyIntegrationSettings />);
    await screen.findByText('Teams Phone');
    expect(flagOff.container.querySelector('#telephony-provider-card-3cx')).toBeNull();

    cleanup();
    mocks.flagEnabled = true;
    mocks.getOverview.mockResolvedValue(overview({
      providers: [teamsPhone(), {
        ...threecx,
        providerAvailability: { enabled: false, reason: 'tier_required', message: '3CX telephony requires the Pro plan.' },
      }],
    }));
    const noTier = render(<TelephonyIntegrationSettings />);
    await screen.findByText('Teams Phone');
    expect(noTier.container.querySelector('#telephony-provider-card-3cx')).toBeNull();
  });

  it('T007: an unconfigured provider explains the Teams prerequisite', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [teamsPhone({ status: 'not_configured', subscriptionId: null, subscriptionExpiresAt: null, prerequisiteMet: false })],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/Configure the Microsoft Teams integration first/)).toBeTruthy();

    await configure();

    await waitFor(() => expect(container.querySelector('#teams-phone-integration-settings')).toBeTruthy());
    expect(screen.getByText(/Configure the Microsoft Teams integration first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable' }).hasAttribute('disabled')).toBe(true);
  });

  it('T007: the settings page reports when Graph last delivered a call notification', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [teamsPhone({ subscriptionExpiresAt: null, lastNotificationAt: '2026-08-22T15:04:00.000Z' })],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    await configure();

    // A silent subscription and a quiet phone look identical without this.
    await waitFor(() =>
      expect(container.querySelector('#telephony-provider-last-notification-teams-phone')?.textContent)
        .toContain('Last call notification'),
    );
  });

  it('T007: the settings page toggles the provider and its auto-ticket policy', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    const { container } = render(<TelephonyIntegrationSettings />);

    await configure();
    await waitFor(() => expect(container.querySelector('#telephony-auto-ticket-toggle-teams-phone')).toBeTruthy());

    fireEvent.click(container.querySelector('#telephony-auto-ticket-toggle-teams-phone')!);
    await waitFor(() =>
      expect(mocks.setAutoTicketPolicy).toHaveBeenCalledWith({ provider: 'teams-phone', autoCreateTickets: true }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(mocks.setProviderEnabled).toHaveBeenCalledWith({ provider: 'teams-phone', enabled: false }),
    );
  });

  it('shows an unavailable state and no provider controls when the release feature is disabled', async () => {
    mocks.getOverview.mockResolvedValue({
      success: true,
      available: false,
      reason: 'feature_disabled',
      error: 'Telephony integrations are not enabled for this tenant.',
      canManage: true,
      canResolve: true,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    });

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Telephony integrations are not enabled for this tenant.')).toBeTruthy();
    expect(screen.queryByText('Teams Phone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
  });

  it('T105: on CE the section renders the unavailable card and no 3CX card', async () => {
    mocks.getOverview.mockResolvedValue({
      success: true,
      available: false,
      reason: 'ce_unavailable',
      error: 'Telephony integrations are only available in Enterprise Edition.',
      canManage: true,
      canResolve: true,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    });

    const { container } = render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText(/only available in Enterprise Edition/i)).toBeTruthy();
    expect(container.querySelector('#telephony-provider-card-3cx')).toBeNull();
    expect(screen.queryByText('Teams Phone')).toBeNull();
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
    const chooserIds = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(chooserIds).toEqual(expect.arrayContaining([
      'telephony-integrations-setup',
      'telephony-provider-card-teams-phone',
    ]));

    await configure();
    await waitFor(() => expect(container.querySelector('#teams-phone-integration-settings')).toBeTruthy());
    const selectedIds = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(selectedIds).toEqual(expect.arrayContaining([
      'telephony-integration-current-provider',
      'telephony-integrations-active-config',
      'telephony-auto-ticket-toggle-teams-phone',
    ]));
    expect([...chooserIds, ...selectedIds].every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });

  it('T011: every chooser and panel control declares a kebab-case id in the source', () => {
    const sources = ['TelephonyIntegrationSettings.tsx', 'TeamsPhoneIntegrationSettings.tsx'].map((file) =>
      fs.readFileSync(path.resolve(__dirname, file), 'utf8'),
    );
    for (const source of sources) {
      const controls = source.match(/<(Button|Switch)\b[^>]*>/g) ?? [];
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        // Static ids, or template-literal ids with a kebab-case prefix per provider.
        const id = control.match(/id="([^"]+)"/) ?? control.match(/id=\{`([a-z0-9-]+)\$\{[^}]+\}`\}/);
        expect(id, `missing id on ${control}`).toBeTruthy();
        expect(id![1]).toMatch(/^[a-z0-9-]+$/);
      }
    }
    expect(sources[0]).toContain('id={`telephony-provider-configure-${provider.provider}`}');
    expect(sources[0]).toContain('id="telephony-integration-change-provider"');
    expect(sources[1]).toContain('id="telephony-provider-toggle-teams-phone"');
  });
});

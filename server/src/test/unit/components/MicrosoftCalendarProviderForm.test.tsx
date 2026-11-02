/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { MicrosoftCalendarProviderForm } from '@alga-psa/ee-calendar/components/calendar/MicrosoftCalendarProviderForm';
import { MICROSOFT_CALENDAR_OAUTH_SCOPES } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { renderWithProviders } from '../../utils/testWrapper';

vi.mock('@alga-psa/ee-calendar/actions', () => ({
  initiateCalendarOAuth: vi.fn(),
  createCalendarProvider: vi.fn(),
  updateCalendarProvider: vi.fn(),
}));
vi.mock('@alga-psa/ee-calendar/lib/actions/integrations/calendarSetupActions', () => ({
  getMicrosoftCalendarSetupStatus: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/ui/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { getMicrosoftCalendarSetupStatus } from '@alga-psa/ee-calendar/lib/actions/integrations/calendarSetupActions';

const REDIRECT_URI = 'https://psa.example.test/api/auth/microsoft/calendar/callback';
const PROVIDERS_URL = '/msp/settings?tab=integrations&category=providers&provider=microsoft';

function setStatus(status: Record<string, unknown>) {
  vi.mocked(getMicrosoftCalendarSetupStatus).mockResolvedValue({ success: true, redirectUri: REDIRECT_URI, ...status } as any);
}

describe('MicrosoftCalendarProviderForm', () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'http://localhost:3000', href: 'http://localhost:3000', assign },
      writable: true,
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the redirect URI before Connect and copies it', async () => {
    setStatus({ ready: true, state: 'ready' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);

    await waitFor(() => expect(screen.getByText(REDIRECT_URI)).toBeInTheDocument());
    await userEvent.click(document.getElementById('microsoft-calendar-redirect-uri-copy')!);
    expect(writeText).toHaveBeenCalledWith(REDIRECT_URI);
    expect(document.getElementById('microsoft-authorize-button')).toBeEnabled();
  });

  it('lists exactly the Calendar scopes, with no Mail.Read, and notes tenancy', async () => {
    setStatus({ ready: true, state: 'ready' });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);

    const list = await waitFor(() => {
      const el = document.getElementById('microsoft-calendar-scopes');
      expect(el).not.toBeNull();
      return el!;
    });
    const shown = Array.from(list.querySelectorAll('li')).map((li) => li.textContent);
    expect(shown).toEqual(MICROSOFT_CALENDAR_OAUTH_SCOPES.map((s) => s.replace('https://graph.microsoft.com/', '')));
    expect(shown).toContain('Calendars.ReadWrite');
    expect(list.textContent).not.toContain('Mail.Read');
    expect(screen.getByText(/single-tenant or multitenant/i)).toBeInTheDocument();
  });

  it('links to the Microsoft profile section of Providers, not the Providers root', async () => {
    setStatus({ ready: true, state: 'ready' });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);

    await waitFor(() => expect(document.getElementById('microsoft-calendar-setup-providers-link')).not.toBeNull());
    await userEvent.click(document.getElementById('microsoft-calendar-setup-providers-link')!);
    expect(assign).toHaveBeenCalledWith(PROVIDERS_URL);
  });

  it('shows the admin-consent-pending state when the callback reports it, and keeps Connect available', async () => {
    setStatus({ ready: true, state: 'ready' });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);
    await waitFor(() => expect(document.getElementById('microsoft-authorize-button')).toBeEnabled());
    expect(screen.queryByText('Administrator approval is pending.')).toBeNull();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'oauth-callback', provider: 'microsoft', resource: 'calendar', success: false,
          error: 'pending_admin_consent', errorDescription: 'Microsoft needs a Microsoft 365 administrator to approve this app',
        },
      }));
    });

    await waitFor(() => expect(screen.getByText('Administrator approval is pending.')).toBeInTheDocument());
    // Distinct from the generic callback failure and the not-configured alert.
    expect(screen.queryByText(/needs a Microsoft 365 administrator/)).toBeNull();
    expect(screen.queryByText('Microsoft provider settings are not configured.')).toBeNull();
    // The user can retry once an admin approves.
    expect(document.getElementById('microsoft-authorize-button')).toBeEnabled();
    await userEvent.click(document.getElementById('microsoft-calendar-admin-consent-providers-link')!);
    expect(assign).toHaveBeenCalledWith(PROVIDERS_URL);
  });

  it('shows other callback failures as a plain error, not the pending state', async () => {
    setStatus({ ready: true, state: 'ready' });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);
    await waitFor(() => expect(document.getElementById('microsoft-authorize-button')).toBeEnabled());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'oauth-callback', provider: 'microsoft', resource: 'calendar', success: false, error: 'token_exchange_failed', errorDescription: 'Boom' },
      }));
    });
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());
    expect(screen.queryByText('Administrator approval is pending.')).toBeNull();
  });

  it('keeps the not-configured alert, pointing at the Microsoft section', async () => {
    setStatus({ ready: false, state: 'not_configured', reasonCode: 'binding_not_configured' });
    renderWithProviders(<MicrosoftCalendarProviderForm tenant="t1" />);

    await waitFor(() => expect(screen.getByText('Microsoft provider settings are not configured.')).toBeInTheDocument());
    await userEvent.click(document.getElementById('configure-microsoft-calendar-providers-link')!);
    expect(assign).toHaveBeenCalledWith(PROVIDERS_URL);
    expect(document.getElementById('microsoft-authorize-button')).toBeDisabled();
  });
});

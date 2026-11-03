/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IntegrationHealthBanner } from '@alga-psa/integrations/components/IntegrationHealthBanner';

const getIntegrationHealthAlerts = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@alga-psa/integrations/actions/integrationHealthActions', () => ({
  getIntegrationHealthAlerts: (...args: unknown[]) => getIntegrationHealthAlerts(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'banners.integrationHealth.inboundEmail.authFailure':
          'Les e-mails entrants de {{mailbox}} sont en pause.',
        'banners.integrationHealth.inboundEmail.error':
          'Les e-mails entrants de {{mailbox}} ont signalé une erreur.',
        'banners.integrationHealth.calendar.error':
          'La synchronisation du calendrier pour {{providerName}} a signalé une erreur.',
        'banners.integrationHealth.calendar.disconnected':
          'La synchronisation du calendrier pour {{providerName}} est déconnectée.',
        'banners.integrationHealth.review': 'Vérifier',
        'banners.integrationHealth.dismiss': "Ignorer l'alerte d'intégration",
      };
      const template = map[key] ?? (options?.defaultValue as string | undefined) ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
        String(options?.[token] ?? '')
      );
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const emailAlert = {
  id: 'inbound_email-provider-1-inbound_email_auth_failure',
  integration: 'inbound_email' as const,
  severity: 'error' as const,
  reason: 'inbound_email_auth_failure' as const,
  providerName: 'Support Mailbox',
  detail: 'support@contoso.example',
  href: '/msp/settings/email',
};

const calendarAlert = {
  id: 'calendar_sync-cal-1-calendar_error',
  integration: 'calendar_sync' as const,
  severity: 'error' as const,
  reason: 'calendar_error' as const,
  providerName: 'Outlook Calendar',
  detail: 'primary',
  href: '/msp/profile?tab=calendar',
};

describe('IntegrationHealthBanner i18n wiring', () => {
  beforeEach(() => {
    getIntegrationHealthAlerts.mockReset();
    window.sessionStorage.clear();
    getIntegrationHealthAlerts.mockResolvedValue([emailAlert, calendarAlert]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders localized copy and a review link per failing integration', async () => {
    render(<IntegrationHealthBanner />);

    await waitFor(() => {
      expect(
        screen.getByText('Les e-mails entrants de support@contoso.example sont en pause.')
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('La synchronisation du calendrier pour Outlook Calendar a signalé une erreur.')
    ).toBeInTheDocument();

    const reviewLinks = screen.getAllByText('Vérifier').map((button) => button.closest('a'));
    expect(reviewLinks.map((link) => link?.getAttribute('href'))).toEqual([
      '/msp/settings/email',
      '/msp/profile?tab=calendar',
    ]);
  });

  it('hides a dismissed alert and keeps it dismissed for the session', async () => {
    render(<IntegrationHealthBanner />);

    await waitFor(() => {
      expect(document.getElementById(`integration-health-alert-${emailAlert.id}`)).not.toBeNull();
    });

    const dismissButtons = screen.getAllByRole('button', { name: "Ignorer l'alerte d'intégration" });
    fireEvent.click(dismissButtons[0]);

    await waitFor(() => {
      expect(document.getElementById(`integration-health-alert-${emailAlert.id}`)).toBeNull();
    });
    expect(document.getElementById(`integration-health-alert-${calendarAlert.id}`)).not.toBeNull();
    expect(
      window.sessionStorage.getItem(`alga.integrationHealth.dismissed.${emailAlert.id}`)
    ).toBe('1');

    cleanup();
    render(<IntegrationHealthBanner />);

    await waitFor(() => {
      expect(document.getElementById(`integration-health-alert-${calendarAlert.id}`)).not.toBeNull();
    });
    expect(document.getElementById(`integration-health-alert-${emailAlert.id}`)).toBeNull();
  });

  it('renders nothing when every integration is healthy', async () => {
    getIntegrationHealthAlerts.mockResolvedValue([]);

    const { container } = render(<IntegrationHealthBanner />);

    await waitFor(() => {
      expect(getIntegrationHealthAlerts).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });
});

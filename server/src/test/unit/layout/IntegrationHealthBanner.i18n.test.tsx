/**
 * @vitest-environment jsdom
 */
import fs from 'node:fs';
import path from 'node:path';
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
        'banners.integrationHealth.rmm.syncError':
          '{{providerName}} a signalé une erreur de synchronisation.',
        'banners.integrationHealth.rmm.reconnectRequired':
          '{{providerName}} doit être reconnecté.',
        'banners.integrationHealth.accounting.reconnectRequired':
          '{{providerName}} doit être reconnecté avant la synchronisation comptable.',
        'banners.integrationHealth.accounting.syncError':
          'La dernière synchronisation avec {{providerName}} ne s\'est pas terminée.',
        'banners.integrationHealth.teams.botCredentialsMissing':
          'Le bot {{providerName}} ne peut pas répondre.',
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

const rmmSyncErrorAlert = {
  id: 'rmm-int-1-rmm_sync_error',
  integration: 'rmm' as const,
  severity: 'error' as const,
  reason: 'rmm_sync_error' as const,
  providerName: 'NinjaOne',
  detail: 'NinjaOne returned HTTP 500',
  href: '/msp/settings/integrations?category=rmm',
};

const rmmReconnectAlert = {
  id: 'rmm-int-2-rmm_reconnect_required',
  integration: 'rmm' as const,
  severity: 'error' as const,
  reason: 'rmm_reconnect_required' as const,
  providerName: 'Tactical RMM',
  detail: 'Tactical RMM',
  href: '/msp/settings/integrations?category=rmm',
};

const accountingReconnectAlert = {
  id: 'accounting-xero-conn-1-accounting_reconnect_required',
  integration: 'accounting' as const,
  severity: 'error' as const,
  reason: 'accounting_reconnect_required' as const,
  providerName: 'Xero',
  detail: 'Contoso Books',
  href: '/msp/settings/integrations?category=accounting',
};

const accountingSyncErrorAlert = {
  id: 'accounting-quickbooks_online-4620816-accounting_sync_error',
  integration: 'accounting' as const,
  severity: 'warning' as const,
  reason: 'accounting_sync_error' as const,
  providerName: 'QuickBooks Online',
  detail: '4620816',
  href: '/msp/settings/integrations?category=accounting',
};

const teamsBotAlert = {
  id: 'teams_bot-teams_bot_credentials_missing',
  integration: 'teams_bot' as const,
  severity: 'warning' as const,
  reason: 'teams_bot_credentials_missing' as const,
  providerName: 'Microsoft Teams',
  detail: '',
  href: '/msp/settings/integrations?category=communication',
};

/** Every reason the banner can render, and the key its copy comes from. */
const MESSAGE_KEYS = [
  'banners.integrationHealth.inboundEmail.authFailure',
  'banners.integrationHealth.inboundEmail.error',
  'banners.integrationHealth.calendar.error',
  'banners.integrationHealth.calendar.disconnected',
  'banners.integrationHealth.rmm.syncError',
  'banners.integrationHealth.rmm.reconnectRequired',
  'banners.integrationHealth.accounting.reconnectRequired',
  'banners.integrationHealth.accounting.syncError',
  'banners.integrationHealth.teams.botCredentialsMissing',
  'banners.integrationHealth.review',
  'banners.integrationHealth.dismiss',
];

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];

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

  it('renders localized copy for the RMM, accounting and Teams reasons', async () => {
    getIntegrationHealthAlerts.mockResolvedValue([
      rmmSyncErrorAlert,
      rmmReconnectAlert,
      accountingReconnectAlert,
      accountingSyncErrorAlert,
      teamsBotAlert,
    ]);

    render(<IntegrationHealthBanner />);

    await waitFor(() => {
      expect(
        screen.getByText('NinjaOne a signalé une erreur de synchronisation.')
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Tactical RMM doit être reconnecté.')).toBeInTheDocument();
    expect(
      screen.getByText('Xero doit être reconnecté avant la synchronisation comptable.')
    ).toBeInTheDocument();
    expect(
      screen.getByText("La dernière synchronisation avec QuickBooks Online ne s'est pas terminée.")
    ).toBeInTheDocument();
    expect(
      screen.getByText('Le bot Microsoft Teams ne peut pas répondre.')
    ).toBeInTheDocument();

    const reviewLinks = screen.getAllByText('Vérifier').map((button) => button.closest('a'));
    expect(reviewLinks.map((link) => link?.getAttribute('href'))).toEqual([
      '/msp/settings/integrations?category=rmm',
      '/msp/settings/integrations?category=rmm',
      '/msp/settings/integrations?category=accounting',
      '/msp/settings/integrations?category=accounting',
      '/msp/settings/integrations?category=communication',
    ]);
  });

  it('ships every banner message key in every shipped locale', () => {
    for (const locale of LOCALES) {
      const pack = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, `../../../../public/locales/${locale}/msp/core.json`),
          'utf8'
        )
      );

      for (const key of MESSAGE_KEYS) {
        const value = key.split('.').reduce<any>((node, segment) => node?.[segment], pack);
        expect(typeof value, `${locale} is missing ${key}`).toBe('string');
      }
    }
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

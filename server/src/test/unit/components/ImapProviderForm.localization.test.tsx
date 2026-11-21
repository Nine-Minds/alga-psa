/** @vitest-environment jsdom */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImapProviderForm } from '@alga-psa/integrations/components/email/ImapProviderForm';
import { ImapProviderForm as EnterpriseImapProviderForm } from '../../../../../ee/server/src/components/ImapProviderForm';
import { renderWithProviders } from '../../utils/testWrapper';

// Keep the production locale lookup instead of the global English-default mock.
vi.mock('@alga-psa/ui/lib/i18n/client', async () => ({
  useTranslation: (await import('react-i18next')).useTranslation,
}));
vi.mock('@alga-psa/integrations/actions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/emailProviderActions', () => ({
  createEmailProvider: vi.fn(), updateEmailProvider: vi.fn(),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/inboundTicketDefaultsActions', () => ({
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));

afterEach(cleanup);

const reauthorizationLabels = [
  ['en', 'Reauthorization required'],
  ['de', 'Erneute Autorisierung erforderlich'],
  ['es', 'Se requiere una nueva autorización'],
  ['fr', 'Nouvelle autorisation requise'],
  ['it', 'Nuova autorizzazione richiesta'],
  ['nl', 'Opnieuw autoriseren vereist'],
  ['pl', 'Wymagana ponowna autoryzacja'],
  ['pt', 'É necessária uma nova autorização'],
  ['sv', 'Ny auktorisering krävs'],
] as const;

describe.each([
  ['standard', ImapProviderForm],
  ['enterprise', EnterpriseImapProviderForm],
] as const)('%s IMAP OAuth localization', (_edition, Form) => {
  it.each(reauthorizationLabels)('renders reauthorization in %s without a missing-key fallback', async (locale, label) => {
    const namespace = 'msp/email-providers';
    const resources = JSON.parse(readFileSync(
      resolve(__dirname, `../../../../public/locales/${locale}/${namespace}.json`),
      'utf8',
    ));
    const common = JSON.parse(readFileSync(
      resolve(__dirname, `../../../../public/locales/${locale}/common.json`),
      'utf8',
    ));
    const missingKeyHandler = vi.fn();
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      ns: ['common', namespace],
      defaultNS: 'common',
      resources: { [locale]: { common, [namespace]: resources } },
      saveMissing: true,
      missingKeyHandler,
      interpolation: { escapeValue: false },
    });

    await act(async () => {
      renderWithProviders(
        <I18nextProvider i18n={i18n}>
          <Form tenant="tenant" onSuccess={vi.fn()} onCancel={vi.fn()} provider={{
            id: 'provider', tenant: 'tenant', providerType: 'imap', providerName: 'Review mailbox',
            mailbox: 'review@example.test', isActive: false,
            imapConfig: { host: 'imap.example.test', port: 993, secure: true, username: 'review',
              auth_type: 'oauth2', oauth_authorization_status: 'reauthorization_required', folder_filters: [] },
          } as any} />
        </I18nextProvider>,
      );
    });

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(missingKeyHandler).not.toHaveBeenCalled();
  });
});

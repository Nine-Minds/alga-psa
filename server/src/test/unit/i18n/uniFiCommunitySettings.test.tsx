/** @vitest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import UniFiIntegrationSettings from '@enterprise/components/settings/integrations/UniFiIntegrationSettings';

vi.unmock('react-i18next');
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { useTranslation } = await import('react-i18next');
  return { useTranslation };
});

afterEach(cleanup);

it('renders the UniFi Pro notice in the selected language and updates when it changes', async () => {
  const i18n = createInstance();
  const resources = Object.fromEntries(['en', 'fr', 'pt'].map(locale => [locale, {
    'msp/integrations': JSON.parse(fs.readFileSync(
      path.resolve(__dirname, `../../../../public/locales/${locale}/msp/integrations.json`), 'utf8',
    )),
  }]));
  await i18n.init({ lng: 'fr', fallbackLng: 'en', resources, interpolation: { escapeValue: false } });
  render(<I18nextProvider i18n={i18n}><UniFiIntegrationSettings /></I18nextProvider>);

  expect(screen.getByText('Fonctionnalité Pro')).toBeTruthy();
  expect(screen.getByText('L’intégration UniFi est disponible dans AlgaPSA Pro.')).toBeTruthy();
  expect(screen.queryByText('Pro Feature')).toBeNull();

  await act(() => i18n.changeLanguage('pt'));
  expect(screen.getByText('Recurso Pro')).toBeTruthy();
  expect(screen.getByText('A integração com UniFi está disponível no AlgaPSA Pro.')).toBeTruthy();
  expect(screen.queryByText('Fonctionnalité Pro')).toBeNull();
});

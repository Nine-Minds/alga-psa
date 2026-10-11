import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';

vi.unmock('@alga-psa/ui/lib/i18n/client');

import { translate } from '@alga-psa/ui/lib/i18n/client';

describe('imperative time-entry translations', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'fr',
      fallbackLng: 'en',
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      resources: {
        fr: {
          common: { launch: { entryNotFound: 'Wrong namespace' } },
          'msp/time-entry': {
            launch: { entryNotFound: 'Entrée de temps introuvable.' },
            workItemEntry: { save: { noPeriod: 'Aucune période pour {{date}}.' } },
          },
        },
        en: {
          'msp/time-entry': { launch: { entryNotFound: 'Time entry not found.' } },
        },
      },
    });
  });

  it('uses the requested namespace and follows changes to the shared locale without a React tree', async () => {
    const message = () => translate('msp/time-entry', 'launch.entryNotFound', {
      defaultValue: 'Time entry not found.',
    });

    expect(message()).toBe('Entrée de temps introuvable.');
    await i18next.changeLanguage('en');
    expect(message()).toBe('Time entry not found.');
  });

  it('interpolates values in localized save rejection messages', () => {
    expect(translate('msp/time-entry', 'workItemEntry.save.noPeriod', {
      date: '2026-10-07',
      defaultValue: 'No time period covers {{date}}.',
    })).toBe('Aucune période pour 2026-10-07.');
  });

  it('keeps messages readable when the time-entry namespace has not loaded', () => {
    i18next.removeResourceBundle('fr', 'msp/time-entry');
    i18next.removeResourceBundle('en', 'msp/time-entry');

    expect(translate('msp/time-entry', 'workItemEntry.save.noPeriod', {
      date: '2026-10-07',
      defaultValue: 'No time period covers {{date}}.',
    })).toBe('No time period covers 2026-10-07.');
  });
});

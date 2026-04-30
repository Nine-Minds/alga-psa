import { describe, expect, it } from 'vitest';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// Pin the locales dir so the test doesn't depend on Next's runtime cwd.
process.env.ALGA_LOCALES_DIR =
  process.env.ALGA_LOCALES_DIR ||
  require('node:path').resolve(__dirname, '../../../../../server/public/locales');

describe('client-portal/service-requests namespace loads server-side', () => {
  it('resolves catalog and detail keys in English', async () => {
    const { t } = await getServerTranslation('en', 'client-portal/service-requests');

    expect(t('catalog.title')).toBe('Service Requests');
    expect(t('detail.formTitle')).toBe('Request Form');
    expect(t('detail.submit')).toBe('Submit Request');
    expect(t('detail.noInitialValues')).toBe('No static defaults configured.');
  });

  it('resolves localized strings in German', async () => {
    const { t } = await getServerTranslation('de', 'client-portal/service-requests');

    expect(t('catalog.title')).toBe('Service-Anfragen');
    expect(t('detail.formTitle')).toBe('Anfrageformular');
  });

  it('falls back to English when a key is missing in the locale', async () => {
    // recent.* keys we just added should be present in EN and translated in DE.
    const { t: tDe } = await getServerTranslation('de', 'client-portal/service-requests');
    expect(tDe('recent.title')).toBe('Ihre letzten Anfragen');
  });
});

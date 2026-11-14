import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prefix = 'clientBillingProfileSettings.';

describe.each(['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'])(
  'billing profile payment translations (%s)',
  (locale) => {
    it('resolves payment labels and interpolates saved payment details without fallbacks', async () => {
      const pack = JSON.parse(readFileSync(resolve(
        __dirname, `../../../../../server/public/locales/${locale}/msp/clients.json`,
      ), 'utf8'));
      const i18n = createInstance();
      await i18n.init({
        lng: locale,
        fallbackLng: false,
        defaultNS: 'msp/clients',
        resources: { [locale]: { 'msp/clients': pack } },
        interpolation: { escapeValue: false },
      });
      const t = (key: string, values = {}) => i18n.t(prefix + key, values);
      for (const key of [
        'paymentMethod', 'paymentMethodHint', 'cardOnFileLabel', 'cardOnFileHint',
        'noCardOnFile', 'cardType.card', 'cardType.bankAccount', 'tenantDefaultValue',
      ]) {
        expect(i18n.exists(prefix + key), key).toBe(true);
        expect(t(key)).not.toBe('');
      }
      expect(t('inheritFromClient', { value: 'Net 30' })).toContain('Net 30');
      // No normalized client terms: the option names the tenant default instead.
      expect(i18n.exists(prefix + 'tenantDefaultValue')).toBe(true);
      expect(t('tenantDefaultValue', { value: 'Net 30' })).toContain('Net 30');
      expect(t('tenantDefaultValue', { value: 'Net 30' })).not.toContain('{{');
      expect(t('legacyPaymentTerms', { value: 'legacy-terms' })).toContain('legacy-terms');
      const expiry = t('cardExpiry', { month: '03', year: '29' });
      expect(expiry).toContain('03/29');
      for (const type of ['card', 'bankAccount']) {
        const label = t(`cardType.${type}`);
        const summary = t('cardOnFile', { type: label, last4: '4242', expiry });
        expect(summary).toContain(label);
        expect(summary).toContain(`4242${expiry}`);
        expect(summary).not.toContain('{{');
        const withoutExpiry = t('cardOnFile', { type: label, last4: '6789', expiry: '' });
        expect(withoutExpiry).toContain(label);
        expect(withoutExpiry).toContain('6789');
        expect(withoutExpiry).not.toContain('{{');
        expect(withoutExpiry).not.toContain('03/29');
      }
    });
  },
);

describe('billing profile payment terms inherit option', () => {
  const source = readFileSync(resolve(__dirname, './ClientBillingProfileSettings.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(resolve(
    __dirname, '../../../../../server/public/locales/en/msp/clients.json',
  ), 'utf8')).clientBillingProfileSettings;

  it('names the tenant default instead of "Not set" when the client holds no terms', () => {
    expect(en.tenantDefaultValue).toBe('Tenant default: {{value}}');
    expect(source).toContain("t('clientBillingProfileSettings.tenantDefaultValue'");
    // The default comes from the resolved tenant default, not a literal.
    expect(source).toMatch(/tenantDefaultValue'[\s\S]{0,120}termsLabels\[clientValues\.tenantDefaultPaymentTerms\]/);
    // The terms select never routes its inherit label through notSetLabel.
    const termsCall = source.slice(source.indexOf("'payment_terms',\n          t("), source.indexOf("'preferred_payment_method',\n          t("));
    expect(termsCall.replace(/\/\/.*$/gm, '')).not.toContain('notSetLabel');
  });

  it('names the client terms that apply, e.g. Net 15', () => {
    expect(source).toMatch(/inheritFromClient'[\s\S]{0,160}termsLabels\[clientValues\.paymentTerms\]/);
    expect(en.inheritFromClient.replace('{{value}}', 'Net 15')).toBe('Inherit from client (Net 15)');
  });
});

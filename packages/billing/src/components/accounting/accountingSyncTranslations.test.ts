import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const localesRoot = new URL('../../../../../server/public/locales/', import.meta.url);
const locales = readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function value(locale: string, key: string): string {
  const translations = JSON.parse(
    readFileSync(new URL(`${locale}/msp/integrations.json`, localesRoot), 'utf8')
  );
  const resolved = key
    .split('.')
    .reduce<any>((acc, part) => (acc == null ? acc : acc[part]), translations);
  if (typeof resolved !== 'string') {
    throw new Error(`Missing ${locale} translation for ${key}`);
  }
  return resolved;
}

function interpolate(template: string, options: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => options[name] ?? _m);
}

describe.each(locales)('accounting sync provider-aware translations (%s)', (locale) => {
  it.each([
    'integrations.qbo.sync.healthCardDescriptionProvider',
    'integrations.qbo.sync.refreshTokenExpiredProvider',
    'integrations.qbo.sync.refreshTokenExpiryProvider',
    'integrations.qbo.sync.autoProvisionCustomersLabelProvider'
  ])('%s interpolates the provider instead of hardcoding QuickBooks', (key) => {
    const template = value(locale, key);
    expect(template).toContain('{{provider}}');
    expect(template).not.toContain('QuickBooks');

    const forXero = interpolate(template, { provider: 'Xero', date: 'Jan 1, 2027' });
    expect(forXero).toContain('Xero');
    expect(forXero).not.toContain('QuickBooks');

    const forQbo = interpolate(template, { provider: 'QuickBooks', date: 'Jan 1, 2027' });
    expect(forQbo).toContain('QuickBooks');
  });
});

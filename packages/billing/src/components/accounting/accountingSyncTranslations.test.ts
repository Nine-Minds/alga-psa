import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const en = JSON.parse(
  readFileSync(
    new URL('../../../../../server/public/locales/en/msp/integrations.json', import.meta.url),
    'utf8'
  )
) as Record<string, any>;

function value(key: string): string {
  const resolved = key
    .split('.')
    .reduce<any>((acc, part) => (acc == null ? acc : acc[part]), en);
  if (typeof resolved !== 'string') {
    throw new Error(`Missing English translation for ${key}`);
  }
  return resolved;
}

function interpolate(template: string, options: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => options[name] ?? _m);
}

describe('accounting sync provider-aware translations', () => {
  it.each([
    'integrations.qbo.sync.healthCardDescriptionProvider',
    'integrations.qbo.sync.refreshTokenExpiredProvider',
    'integrations.qbo.sync.refreshTokenExpiryProvider',
    'integrations.qbo.sync.autoProvisionCustomersLabelProvider'
  ])('%s interpolates the provider instead of hardcoding QuickBooks', (key) => {
    const template = value(key);
    expect(template).toContain('{{provider}}');
    expect(template).not.toContain('QuickBooks');

    const forXero = interpolate(template, { provider: 'Xero', date: 'Jan 1, 2027' });
    expect(forXero).toContain('Xero');
    expect(forXero).not.toContain('QuickBooks');

    const forQbo = interpolate(template, { provider: 'QuickBooks', date: 'Jan 1, 2027' });
    expect(forQbo).toContain('QuickBooks');
  });
});

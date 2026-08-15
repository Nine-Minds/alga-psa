import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BUCKET_THRESHOLD_REACHED_SUBTYPE,
  BUCKET_THRESHOLD_REACHED_TEMPLATE,
  CREDIT_LOW_BALANCE_SUBTYPE,
  CREDIT_LOW_BALANCE_TEMPLATE,
  buildBucketAlertContext,
  buildCreditAlertContext,
  buildInternalAlertContext,
  clientAlertLink,
  managerAlertLink,
} from './prepaidBalanceAlertTemplates';

const require = createRequire(import.meta.url);
const migrationsDir = path.resolve(__dirname, '../../../migrations');
const { SUPPORTED_LANGUAGES } = require(path.join(migrationsDir, 'utils/templates/_shared/constants.cjs'));
const emailModule = require(path.join(migrationsDir, 'utils/templates/email/billing/prepaidBalanceAlerts.cjs'));
const internalModule = require(path.join(migrationsDir, 'utils/templates/internal/prepaidBalanceAlerts.cjs'));

function placeholdersOf(text: string): string[] {
  const matches = [...text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

describe('prepaid balance alert notification definitions', () => {
  it('registers both credit and bucket templates with stable names/subtypes', () => {
    expect(CREDIT_LOW_BALANCE_TEMPLATE).toBe('prepaid-credit-low-balance');
    expect(CREDIT_LOW_BALANCE_SUBTYPE).toBe('prepaid-credit-low-balance');
    expect(BUCKET_THRESHOLD_REACHED_TEMPLATE).toBe('prepaid-bucket-threshold-reached');
    expect(BUCKET_THRESHOLD_REACHED_SUBTYPE).toBe('prepaid-bucket-threshold-reached');
  });

  it('ships every billing-email locale for both email templates', () => {
    for (const template of emailModule.getTemplates()) {
      const locales = template.translations.map((t: { language: string }) => t.language).sort();
      expect([...locales].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    }
  });

  it('ships every locale for both internal templates', () => {
    const names = internalModule.TEMPLATES.map((t: { templateName: string }) => t.templateName);
    expect(names).toContain(CREDIT_LOW_BALANCE_TEMPLATE);
    expect(names).toContain(BUCKET_THRESHOLD_REACHED_TEMPLATE);
    for (const template of internalModule.TEMPLATES) {
      const locales = Object.keys(template.translations).sort();
      expect([...locales].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    }
  });

  it('exposes distinct role-safe navigation links', () => {
    expect(managerAlertLink('client-123')).toContain('/msp/clients/client-123?tab=billing');
    expect(managerAlertLink('client-123')).not.toContain('/client-portal/billing');
    expect(clientAlertLink()).toContain('/client-portal/billing');
    expect(clientAlertLink()).not.toContain('/msp/clients/');
  });

  it('internal placeholders are all covered by the flat internal context keys', () => {
    // The internal renderer substitutes only flat top-level keys; every
    // {{placeholder}} shipped in the internal templates must have a matching
    // flat key in buildInternalAlertContext output. No dotted/nested paths.
    const creditContext = buildInternalAlertContext('Acme', {
      currency: 'USD',
      available: '$12.34',
      threshold: '$50.00',
      link: 'https://app.example/msp/clients/c1?tab=billing',
    });
    const bucketContext = buildInternalAlertContext('Acme', {
      percent: 80,
      usedPercent: 92.5,
      capacity: '100 h',
      used: '92.5 h',
      link: 'https://app.example/msp/clients/c1?tab=billing',
    });

    for (const template of internalModule.TEMPLATES as Array<{ templateName: string; translations: Record<string, { title: string; message: string }> }>) {
      const en = template.translations.en;
      const text = `${en.title} ${en.message}`;
      const placeholders = placeholdersOf(text);
      const expected = template.templateName === CREDIT_LOW_BALANCE_TEMPLATE ? creditContext : bucketContext;
      for (const placeholder of placeholders) {
        expect(Object.prototype.hasOwnProperty.call(expected, placeholder), placeholder).toBe(true);
      }
      // Every context key is a simple flat identifier the renderer can reach.
      expect(Object.keys(expected).every((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))).toBe(true);
      expect(Object.keys(expected).some((key) => key.includes('.'))).toBe(false);
    }
  });

  it('builds template contexts with the variables both variants render', () => {
    const credit = buildCreditAlertContext('Acme', {
      currency: 'USD',
      threshold: '$50.00',
      available: '$12.34',
      link: 'https://app.example/msp/clients/c1?tab=billing',
    }) as { client: { name: string }; alert: Record<string, unknown> };
    expect(credit.client.name).toBe('Acme');
    expect(credit.alert).toMatchObject({ currency: 'USD', threshold: '$50.00', available: '$12.34' });

    const bucket = buildBucketAlertContext('Acme', {
      percent: 80,
      usedPercent: 92.5,
      capacity: '100 h',
      used: '92.5 h',
      link: 'https://portal.example/client-portal/billing',
    }) as { client: { name: string }; alert: Record<string, unknown> };
    expect(bucket.client.name).toBe('Acme');
    expect(bucket.alert).toMatchObject({ percent: 80, usedPercent: 92.5, capacity: '100 h', used: '92.5 h' });
  });
});

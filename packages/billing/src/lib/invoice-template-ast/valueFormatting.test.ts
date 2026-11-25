import { describe, expect, it } from 'vitest';
import { formatTemplateValue } from './valueFormatting';
import { formatTemplateFieldValue } from './fieldFormatting';
import type { TemplateLabelTranslator } from './i18nLabels';

const german: TemplateLabelTranslator = (key, { defaultValue }) =>
  ({ 'labels.yes': 'Ja', 'labels.no': 'Nein', 'labels.cadence.monthly': 'Monatlich' } as Record<string, string>)[key] ?? defaultValue;

const passthrough = (value: unknown) => `fallback:${String(value)}`;

describe('formatTemplateValue', () => {
  it('prints a boolean with no mapping as Yes/No, localized when a translator is given', () => {
    expect(formatTemplateValue({ value: true, fallback: passthrough })).toBe('Yes');
    expect(formatTemplateValue({ value: false, fallback: passthrough })).toBe('No');
    expect(formatTemplateValue({ value: true, t: german, fallback: passthrough })).toBe('Ja');
    expect(formatTemplateValue({ value: false, t: german, fallback: passthrough })).toBe('Nein');
  });

  it('lets a valueLabels mapping win over the Yes/No default', () => {
    const valueLabels = { true: 'Included', false: 'Excluded' };
    expect(formatTemplateValue({ value: true, valueLabels, fallback: passthrough })).toBe('Included');
    expect(formatTemplateValue({ value: false, valueLabels, fallback: passthrough })).toBe('Excluded');
  });

  it('resolves a key reference label through the translator', () => {
    const valueLabels = { monthly: { i18nKey: 'labels.cadence.monthly', defaultValue: 'Monthly' } };
    expect(formatTemplateValue({ value: 'monthly', valueLabels, t: german, fallback: passthrough })).toBe('Monthly'.replace('Monthly', 'Monatlich'));
    expect(formatTemplateValue({ value: 'monthly', valueLabels, fallback: passthrough })).toBe('Monthly');
  });

  it('prints blank when a value is mapped to an empty label', () => {
    expect(formatTemplateValue({ value: false, valueLabels: { false: '' }, fallback: passthrough })).toBe('');
    expect(formatTemplateValue({ value: true, valueLabels: { false: '' }, fallback: passthrough })).toBe('Yes');
  });

  it('falls through for a value with no mapping', () => {
    expect(formatTemplateValue({ value: 'weekly', valueLabels: { monthly: 'Monthly' }, fallback: passthrough })).toBe('fallback:weekly');
    expect(formatTemplateValue({ value: 42, fallback: passthrough })).toBe('fallback:42');
  });

  it('does not treat prototype keys as mappings', () => {
    expect(formatTemplateValue({ value: 'constructor', valueLabels: {}, fallback: passthrough })).toBe('fallback:constructor');
  });
});

describe('field path: number, date and currency output is unchanged', () => {
  it('still formats currency, number and date through the field formatter', () => {
    const base = { currencyCode: 'USD', locale: 'en-US' } as const;
    expect(formatTemplateFieldValue({ ...base, value: 123456, format: 'currency' }).text).toBe('$1,234.56');
    expect(formatTemplateFieldValue({ ...base, value: '12.50', format: 'number' }).text).toBe('12.5');
    expect(formatTemplateFieldValue({ ...base, value: '2026-07-13', format: 'date' }).text).toBe('07/13/2026');
  });

  it('prints localized Yes/No for a boolean field and honors valueLabels', () => {
    expect(formatTemplateFieldValue({ value: true, format: 'text', currencyCode: 'USD' }).text).toBe('Yes');
    expect(formatTemplateFieldValue({ value: false, format: 'text', currencyCode: 'USD', t: german }).text).toBe('Nein');
    expect(
      formatTemplateFieldValue({ value: false, format: 'text', currencyCode: 'USD', valueLabels: { false: 'Excluded' } }).text
    ).toBe('Excluded');
    expect(
      formatTemplateFieldValue({ value: false, format: 'text', currencyCode: 'USD', valueLabels: { false: '' } })
    ).toEqual({ text: null, multiline: false });
  });
});

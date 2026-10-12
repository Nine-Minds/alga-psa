import { describe, expect, it } from 'vitest';
import { templateNeedsRates, templatePickerLabel } from './templatePickerOption';

const t = (key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));

const usdOnly = { contract_name: 'Managed', currency_code: 'USD', price_set_currencies: [] as string[] };
const usdEur = { contract_name: 'Managed', currency_code: 'USD', price_set_currencies: ['EUR'] };

describe('template picker currency badges and "needs rates" hint', () => {
  it('lists base currency first, then the price-set currencies', () => {
    expect(templatePickerLabel(t, usdEur, undefined, undefined)).toBe('Managed · USD · EUR');
    expect(templatePickerLabel(t, usdOnly, undefined, undefined)).toBe('Managed · USD');
  });

  it('shows no hint before a client (and so a contract currency) is known', () => {
    expect(templatePickerLabel(t, usdOnly, undefined, 'EUR')).toBe('Managed · USD');
    expect(templateNeedsRates(usdOnly, 'client-1', undefined)).toBe(false);
  });

  it('flags a template with neither a matching base nor a price set, without hiding it', () => {
    expect(templatePickerLabel(t, usdOnly, 'client-1', 'EUR')).toBe('Managed · USD · Needs EUR rates');
  });

  it('does not flag a base match or a complete matching price set', () => {
    expect(templatePickerLabel(t, usdOnly, 'client-1', 'USD')).toBe('Managed · USD');
    expect(templatePickerLabel(t, usdEur, 'client-1', 'EUR')).toBe('Managed · USD · EUR');
  });

  it('flags an incomplete price set', () => {
    const partial = { ...usdEur, incomplete_set_currencies: ['EUR'] };
    expect(templateNeedsRates(partial, 'client-1', 'EUR')).toBe(true);
  });
});

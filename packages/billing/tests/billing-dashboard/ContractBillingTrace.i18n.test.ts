import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const load = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../server/public/locales/${locale}/msp/contracts.json`), 'utf8'));
const leaves = (value: unknown, prefix = ''): Record<string, string> =>
  typeof value === 'string'
    ? { [prefix]: value }
    : Object.entries(value as object).reduce((acc, [k, v]) => ({ ...acc, ...leaves(v, prefix ? `${prefix}.${k}` : k) }), {});
const tokens = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

const TRACE_KEYS = [
  ...Object.keys(leaves(load('en').contractOverview.billing)).map((k) => `contractOverview.billing.${k}`),
  'contractDetail.clientAssignment.billingProfileUseDefault',
  'contractDetail.clientAssignment.billingProfileAssigned',
  'contractDetail.clientAssignment.billingProfileUnavailable',
  'contractDetail.clientAssignment.billingProfileLoading',
];

describe.each(['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'])(
  'contract billing trace translations (%s)',
  (locale) => {
    it('has every key with the same interpolation tokens as English', () => {
      const en = leaves(load('en'));
      const other = leaves(load(locale));
      expect(TRACE_KEYS.length).toBeGreaterThan(40);
      for (const key of TRACE_KEYS) {
        expect(other[key], `${locale}:${key}`).toBeTruthy();
        expect(tokens(other[key]), `${locale}:${key}`).toEqual(tokens(en[key]));
      }
    });
  },
);

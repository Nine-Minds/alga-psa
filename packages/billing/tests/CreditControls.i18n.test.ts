// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pseudoPattern } from '../../../tools/i18n/lib/pseudo-locale.mjs';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('Credits control i18n wiring contract', () => {
  it('T009: AddCreditButton wires trigger, dialog title, body copy, and actions through msp/credits', () => {
    const source = read('../src/components/credits/AddCreditButton.tsx');

    expect(source).toContain("const { t, i18n } = useTranslation('msp/credits');");
    expect(source).toContain("t('actions.addCredit', { defaultValue: 'Add Credit' })");
    expect(source).toContain("t('addCredit.fields.client', { defaultValue: 'Client' })");
    expect(source).toContain("t('addCredit.fields.amount', { defaultValue: 'Amount' })");
    expect(source).toContain("t('actions.cancel', { defaultValue: 'Cancel' })");
  });

  it('T010: AddCreditButton pseudo-locale keys resolve to xx fill values instead of raw English', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    expect(getLeaf(pseudo, 'actions.addCredit')).toMatch(pseudoPattern('xx'));
    expect(getLeaf(pseudo, 'actions.cancel')).toMatch(pseudoPattern('xx'));
    expect(getLeaf(pseudo, 'addCredit.fields.client')).toMatch(pseudoPattern('xx'));
  });
});

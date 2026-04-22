// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('actions.addCredit', { defaultValue: 'Add Credit' })");
    expect(source).toContain("t('management.addCreditPlaceholder', {");
    expect(source).toContain("t('actions.cancel', { defaultValue: 'Cancel' })");
  });

  it('T010: AddCreditButton pseudo-locale keys resolve to xx fill values instead of raw English', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    expect(getLeaf(pseudo, 'actions.addCredit')).toBe('11111');
    expect(getLeaf(pseudo, 'actions.cancel')).toBe('11111');
    expect(getLeaf(pseudo, 'management.addCreditPlaceholder')).toBe('11111');
  });

  it('T011: BackButton wires the visible label through msp/credits', () => {
    const source = read('../src/components/credits/BackButton.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('actions.backToCredits', { defaultValue: 'Back to Credits' })");
  });

  it('T012: BackButton pseudo-locale label is backed by xx fill instead of English', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    expect(getLeaf(pseudo, 'actions.backToCredits')).toBe('11111');
  });
});

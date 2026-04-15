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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('EditContractLineServiceQuantityDialog i18n wiring contract', () => {
  it('T029: wires the dialog title (with interpolated service name), quantity label, and validation messages through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/EditContractLineServiceQuantityDialog.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('editQuantityDialog.title', {");
    expect(source).toContain("t('editQuantityDialog.fields.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('editQuantityDialog.validation.empty', { defaultValue: 'Quantity cannot be empty.' })");
    expect(source).toContain("t('editQuantityDialog.validation.positiveWholeNumber', {");
    expect(source).toContain("t('editQuantityDialog.errors.saveFailed', {");
  });

  it('T030: wires the save and cancel button labels (plus saving state) through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/EditContractLineServiceQuantityDialog.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('editQuantityDialog.actions.cancel', { defaultValue: 'Cancel' })");
    expect(source).toContain("t('editQuantityDialog.actions.saveQuantity', { defaultValue: 'Save Quantity' })");
    expect(source).toContain("t('editQuantityDialog.actions.saving', { defaultValue: 'Saving...' })");

    const pseudoKeys = [
      'editQuantityDialog.fields.quantity',
      'editQuantityDialog.validation.empty',
      'editQuantityDialog.validation.positiveWholeNumber',
      'editQuantityDialog.actions.cancel',
      'editQuantityDialog.actions.saveQuantity',
      'editQuantityDialog.actions.saving',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }

    // editQuantityDialog.title contains a {{serviceName}} interpolation, so the pseudo
    // locale generator emits "11111 {{serviceName}} 11111" rather than a bare "11111".
    // Just verify the key exists, starts with the pseudo marker, and preserves the token.
    const pseudoTitle = getLeaf(pseudo, 'editQuantityDialog.title');
    expect(typeof pseudoTitle).toBe('string');
    expect(pseudoTitle as string).toContain('11111');
    expect(pseudoTitle as string).toContain('{{serviceName}}');
  });
});

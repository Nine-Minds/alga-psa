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

describe('LineItem i18n wiring contract', () => {
  it('T015: wires the line item field labels and discount type options through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/LineItem.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('lineItem.fields.service', { defaultValue: 'Service' })");
    expect(source).toContain("t('lineItem.fields.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('lineItem.fields.description', { defaultValue: 'Description' })");
    expect(source).toContain("t('lineItem.fields.discountType', { defaultValue: 'Discount Type' })");
    expect(source).toContain("t('lineItem.fields.percentage', { defaultValue: 'Percentage' })");
    expect(source).toContain("t('lineItem.fields.discountDescription', { defaultValue: 'Discount Description' })");
    expect(source).toContain("t('lineItem.fields.applyDiscountTo', { defaultValue: 'Apply Discount To' })");
    expect(source).toContain("t('lineItem.fields.entireInvoice', { defaultValue: 'Entire Invoice' })");
    expect(source).toContain("t('lineItem.options.percentage', { defaultValue: 'Percentage' })");
    expect(source).toContain("t('lineItem.options.fixedAmount', { defaultValue: 'Fixed Amount' })");
  });

  it('T016: wires the collapsed summary, action buttons, and subtotal text through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/LineItem.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('lineItem.collapsed.itemDiscount', { defaultValue: 'Item Discount' })");
    expect(source).toContain("t('lineItem.collapsed.invoiceDiscount', { defaultValue: 'Invoice Discount' })");
    expect(source).toContain("t('lineItem.collapsed.selectService', { defaultValue: 'Select Service' })");
    expect(source).toContain("t('lineItem.collapsed.taxable', { defaultValue: '(Taxable)' })");
    expect(source).toContain("t('lineItem.collapsed.nonTaxable', { defaultValue: '(Non-Taxable)' })");
    expect(source).toContain("t('lineItem.collapsed.calculatedOnSave', { defaultValue: '(calculated on save)' })");
    expect(source).toContain("t('lineItem.expanded.discount', { defaultValue: 'Discount' })");
    expect(source).toContain("t('lineItem.expanded.markedForRemoval', { defaultValue: 'Marked for removal' })");
    expect(source).toContain("t('lineItem.actions.add', { defaultValue: 'Add' })");
    expect(source).toContain("t('lineItem.actions.remove', { defaultValue: 'Remove' })");
    expect(source).toContain("t('lineItem.actions.restore', { defaultValue: 'Restore' })");

    const pseudoKeys = [
      'lineItem.fields.service',
      'lineItem.fields.quantity',
      'lineItem.fields.description',
      'lineItem.fields.discountType',
      'lineItem.fields.applyDiscountTo',
      'lineItem.fields.entireInvoice',
      'lineItem.collapsed.itemDiscount',
      'lineItem.collapsed.taxable',
      'lineItem.actions.add',
      'lineItem.actions.remove',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

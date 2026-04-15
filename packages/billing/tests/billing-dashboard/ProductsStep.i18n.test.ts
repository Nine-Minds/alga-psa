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

describe('ProductsStep i18n wiring contract', () => {
  it('T050: step heading, product picker, quantity/rate labels, and empty state use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ProductsStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardProducts.heading',
      'wizardProducts.description',
      'wizardProducts.emptyState',
      'wizardProducts.labels.products',
      'wizardProducts.labels.productItem',
      'wizardProducts.labels.selectProductPlaceholder',
      'wizardProducts.labels.quantity',
      'wizardProducts.labels.overrideUnitPriceOptional',
      'wizardProducts.labels.defaultCatalogPrice',
      'wizardProducts.validation.noDefaultPriceEnterUnitPrice',
      'wizardProducts.validation.productMissingPrice',
      'wizardProducts.actions.addProduct',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

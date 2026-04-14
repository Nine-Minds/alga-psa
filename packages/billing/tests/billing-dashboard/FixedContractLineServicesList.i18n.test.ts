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

describe('FixedContractLineServicesList i18n wiring contract', () => {
  it('T017: wires the associated-services table headers and billing method labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/FixedContractLineServicesList.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('contractLineServices.table.serviceName', { defaultValue: 'Service Name' })");
    expect(source).toContain("t('contractLineServices.table.category', { defaultValue: 'Category' })");
    expect(source).toContain("t('contractLineServices.table.billingMethod', { defaultValue: 'Billing Method' })");
    expect(source).toContain("t('contractLineServices.table.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('contractLineServices.table.defaultRate', { defaultValue: 'Default Rate' })");
    expect(source).toContain("t('contractLineServices.table.actions', { defaultValue: 'Actions' })");
    expect(source).toContain("t('contractLineServices.billingMethods.fixed', { defaultValue: 'Fixed Price' })");
    expect(source).toContain("t('contractLineServices.billingMethods.hourly', { defaultValue: 'Hourly' })");
    expect(source).toContain("t('contractLineServices.billingMethods.usageBased', { defaultValue: 'Usage Based' })");
    expect(source).toContain("t('contractLineServices.badges.product', { defaultValue: 'Product' })");
    expect(source).toContain("t('contractLineServices.badges.service', { defaultValue: 'Service' })");
  });

  it('T018: wires the add-services section heading, empty states, and action menu items through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/FixedContractLineServicesList.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('contractLineServices.addSection.title', { defaultValue: 'Add Services to Contract Line' })");
    expect(source).toContain("t('contractLineServices.actions.editQuantity', { defaultValue: 'Edit Quantity' })");
    expect(source).toContain("t('contractLineServices.actions.remove', { defaultValue: 'Remove' })");
    expect(source).toContain("t('contractLineServices.states.loading', { defaultValue: 'Loading services...' })");
    expect(source).toContain("t('contractLineServices.errors.loadData', { defaultValue: 'Failed to load services data' })");
    expect(source).toContain("t('contractLineServices.errors.addServices', { defaultValue: 'Failed to add services' })");
    expect(source).toContain("t('contractLineServices.errors.removeService', { defaultValue: 'Failed to remove service' })");
    expect(source).toContain("t('contractLineServices.unknownService', { defaultValue: 'Unknown Service' })");
    expect(source).toContain("t('common.openMenu', { defaultValue: 'Open menu' })");
    expect(source).toContain("t('common.notAvailable', { defaultValue: 'N/A' })");

    const pseudoKeys = [
      'contractLineServices.table.serviceName',
      'contractLineServices.table.billingMethod',
      'contractLineServices.table.defaultRate',
      'contractLineServices.billingMethods.fixed',
      'contractLineServices.billingMethods.hourly',
      'contractLineServices.billingMethods.usageBased',
      'contractLineServices.addSection.title',
      'contractLineServices.actions.editQuantity',
      'contractLineServices.actions.remove',
      'contractLineServices.states.loading',
      'contractLineServices.unknownService',
      'common.openMenu',
      'common.notAvailable',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

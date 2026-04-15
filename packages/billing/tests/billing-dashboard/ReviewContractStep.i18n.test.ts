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

describe('ReviewContractStep i18n wiring contract', () => {
  it('T053: Contract Basics section labels and fallback values use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardReview.heading',
      'wizardReview.description',
      'wizardReview.sections.contractBasics',
      'wizardReview.fields.client',
      'wizardReview.fields.contractName',
      'wizardReview.fields.billingFrequency',
      'wizardReview.fields.currency',
      'wizardReview.fields.startDate',
      'wizardReview.fields.endDate',
      'wizardReview.fields.renewalMode',
      'wizardReview.fields.noticePeriod',
      'wizardReview.fields.renewalTerm',
      'wizardReview.fallback.notSelected',
      'wizardReview.fallback.notSpecified',
      'wizardReview.fallback.notApplicable',
      'wizardReview.fallback.ongoing',
      'wizardReview.renewalMode.none',
      'wizardReview.renewalMode.manual',
      'wizardReview.renewalMode.auto',
      'wizardReview.noticePeriod.one',
      'wizardReview.noticePeriod.other',
      'wizardReview.renewalTerm.one',
      'wizardReview.renewalTerm.other',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

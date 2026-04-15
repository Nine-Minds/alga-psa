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

describe('ContractBasicsStep i18n wiring contract', () => {
  it('T047: step heading, template-picker labels, and client-picker labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardBasics.heading',
      'wizardBasics.description',
      'wizardBasics.template.startFromTemplate',
      'wizardBasics.template.loadingTemplates',
      'wizardBasics.template.selectTemplateOptional',
      'wizardBasics.template.prefillHint',
      'wizardBasics.template.loadingTemplateDetails',
      'wizardBasics.template.preview.templateLabel',
      'wizardBasics.template.preview.billingCadenceLabel',
      'wizardBasics.template.preview.notSpecified',
      'wizardBasics.client.clientLabel',
      'wizardBasics.client.loadingClients',
      'wizardBasics.client.selectClient',
      'wizardBasics.client.chooseClientHint',
      'wizardBasics.contractName.label',
      'wizardBasics.contractName.placeholder',
      'wizardBasics.contractName.hint',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

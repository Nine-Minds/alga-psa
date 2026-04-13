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

describe('Template + small components i18n wiring contract', () => {
  it('T033: TemplateRenderer wires loading, error prefix, and empty state through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/TemplateRenderer.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('templateRenderer.loading', { defaultValue: 'Loading template preview...' })");
    expect(source).toContain("t('templateRenderer.errorPrefix', { defaultValue: 'Error:' })");
    expect(source).toContain("t('templateRenderer.empty', { defaultValue: 'Please select an invoice and a template to preview.' })");

    expect(getLeaf(pseudo, 'templateRenderer.loading')).toBe('11111');
    expect(getLeaf(pseudo, 'templateRenderer.errorPrefix')).toBe('11111');
    expect(getLeaf(pseudo, 'templateRenderer.empty')).toBe('11111');
  });

  it('T034: PropertyEditor wires the inspector field labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/PropertyEditor.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('templateDesigner.propertyEditor.selectField', { defaultValue: 'Select a field' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.content', { defaultValue: 'Content' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.dataField', { defaultValue: 'Data Field' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.width', { defaultValue: 'Width' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.height', { defaultValue: 'Height' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.fontSize', { defaultValue: 'Font Size' })");
    expect(source).toContain("t('templateDesigner.propertyEditor.color', { defaultValue: 'Color' })");

    const pseudoKeys = [
      'templateDesigner.propertyEditor.selectField',
      'templateDesigner.propertyEditor.content',
      'templateDesigner.propertyEditor.dataField',
      'templateDesigner.propertyEditor.width',
      'templateDesigner.propertyEditor.height',
      'templateDesigner.propertyEditor.fontSize',
      'templateDesigner.propertyEditor.color',
    ];
    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });

  it('T035: ConditionalRuleManager wires heading, action options, placeholders, and Add Rule button through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/ConditionalRuleManager.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('templateDesigner.conditionalRules.title', { defaultValue: 'Conditional Display Rules' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.selectAction', { defaultValue: 'Select Action' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.show', { defaultValue: 'Show' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.hide', { defaultValue: 'Hide' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.format', { defaultValue: 'Format' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.conditionPlaceholder', { defaultValue: 'Condition' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.targetPlaceholder', { defaultValue: 'Target' })");
    expect(source).toContain("t('templateDesigner.conditionalRules.addRule', { defaultValue: 'Add Rule' })");

    const pseudoKeys = [
      'templateDesigner.conditionalRules.title',
      'templateDesigner.conditionalRules.selectAction',
      'templateDesigner.conditionalRules.show',
      'templateDesigner.conditionalRules.hide',
      'templateDesigner.conditionalRules.format',
      'templateDesigner.conditionalRules.conditionPlaceholder',
      'templateDesigner.conditionalRules.targetPlaceholder',
      'templateDesigner.conditionalRules.addRule',
    ];
    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });

  it('T036: ContractsHub wires the "Contracts" heading and the two sub-tab labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/ContractsHub.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('contractsHub.title', { defaultValue: 'Contracts' })");
    expect(source).toContain("t('contractsHub.tabs.templates', { defaultValue: 'Templates' })");
    expect(source).toContain("t('contractsHub.tabs.clientContracts', { defaultValue: 'Client Contracts' })");

    expect(getLeaf(pseudo, 'contractsHub.title')).toBe('11111');
    expect(getLeaf(pseudo, 'contractsHub.tabs.templates')).toBe('11111');
    expect(getLeaf(pseudo, 'contractsHub.tabs.clientContracts')).toBe('11111');
  });

  it('T037: TemplateRendererCore fallback strings are documented as generated-invoice output rather than dashboard chrome', () => {
    const source = read('../../src/components/billing-dashboard/TemplateRendererCore.ts');

    // The core renderer still emits these as raw strings because they appear inside the
    // rendered invoice HTML body, not the dashboard UI. Verify the documentation boundary
    // is in place alongside the fallbacks.
    expect(source).toContain("'Uncategorized'");
    expect(source).toContain('No data for list: ${list.name}');
    expect(source).toContain("return 'N/A';");
    expect(source).toContain("return 'Unknown value';");
    expect(source).toContain('generated invoice HTML, not dashboard UI chrome');
    expect(source).toContain('rendered into invoice output');

    // And they must NOT have been force-wired into useTranslation (the file is a pure
    // renderer and cannot hold hook context).
    expect(source).not.toContain("useTranslation('msp/billing')");
  });
});

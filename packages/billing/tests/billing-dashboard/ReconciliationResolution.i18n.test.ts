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

describe('ReconciliationResolution i18n wiring contract', () => {
  it('T002: wires the stepper labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/ReconciliationResolution.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('reconciliation.steps.review', { defaultValue: 'Review Discrepancy' })");
    expect(source).toContain("t('reconciliation.steps.approval', { defaultValue: 'Approval' })");
    expect(source).toContain("t('reconciliation.steps.confirmation', { defaultValue: 'Confirmation' })");

    expect(getLeaf(pseudo, 'reconciliation.steps.review')).toBe('11111');
    expect(getLeaf(pseudo, 'reconciliation.steps.approval')).toBe('11111');
    expect(getLeaf(pseudo, 'reconciliation.steps.confirmation')).toBe('11111');
  });

  it('T003: wires the resolution options through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/ReconciliationResolution.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('reconciliation.resolutionTypes.recommended', { defaultValue: 'Recommended Fix' })");
    expect(source).toContain("t('reconciliation.resolutionTypes.custom', { defaultValue: 'Custom Correction' })");
    expect(source).toContain("t('reconciliation.resolutionTypes.noAction', { defaultValue: 'No Action Required' })");

    expect(getLeaf(pseudo, 'reconciliation.resolutionTypes.recommended')).toBe('11111');
    expect(getLeaf(pseudo, 'reconciliation.resolutionTypes.custom')).toBe('11111');
    expect(getLeaf(pseudo, 'reconciliation.resolutionTypes.noAction')).toBe('11111');
  });
});

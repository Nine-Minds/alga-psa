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

describe('RecommendedFixPanel i18n wiring contract', () => {
  it('T023: wires the fix option headings and per-issue-type descriptions through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/RecommendedFixPanel.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('recommendedFix.title', { defaultValue: 'Recommended Fixes' })");
    expect(source).toContain("t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' })");
    expect(source).toContain("t('recommendedFix.panels.alternativeFix', { defaultValue: 'Alternative Fix' })");
    expect(source).toContain("t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' })");
    expect(source).toContain("t('recommendedFix.panels.noActionRequired', { defaultValue: 'No Action Required' })");
    expect(source).toContain("t('recommendedFix.buttons.createTrackingEntry', { defaultValue: 'Create Credit Tracking Entry' })");
    expect(source).toContain("t('recommendedFix.buttons.updateRemainingAmount', { defaultValue: 'Update Remaining Amount' })");
    expect(source).toContain("t('recommendedFix.buttons.applyAdjustment', { defaultValue: 'Apply Credit Adjustment' })");
    expect(source).toContain("t('recommendedFix.buttons.applyCustomAdjustment', { defaultValue: 'Apply Custom Adjustment' })");
    expect(source).toContain("t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' })");
    expect(source).toContain("recommendedFix.descriptions.missingTrackingRecommended");
    expect(source).toContain("recommendedFix.descriptions.inconsistentRemainingRecommended");
    expect(source).toContain("recommendedFix.descriptions.genericRecommended");
    expect(source).toContain("recommendedFix.descriptions.noAction");
  });

  it('T024: wires the fix dialog title/description, adjustment/notes fields, impact summary, and resolved state through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/RecommendedFixPanel.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('recommendedFix.dialog.adjustmentAmount', { defaultValue: 'Adjustment Amount' })");
    expect(source).toContain("t('recommendedFix.dialog.adjustmentHint', {");
    expect(source).toContain("t('recommendedFix.dialog.notes', { defaultValue: 'Notes' })");
    expect(source).toContain("t('recommendedFix.dialog.notesPlaceholder', {");
    expect(source).toContain("t('recommendedFix.errors.notesRequired', {");
    expect(source).toContain("t('recommendedFix.errors.invalidAmount', {");
    expect(source).toContain("t('recommendedFix.errors.unknown', { defaultValue: 'An unknown error occurred' })");
    expect(source).toContain("t('recommendedFix.impactSummary.title', { defaultValue: 'Impact Summary' })");
    expect(source).toContain("t('recommendedFix.impactSummary.currentBalance', { defaultValue: 'Current Balance' })");
    expect(source).toContain("t('recommendedFix.impactSummary.newBalance', { defaultValue: 'New Balance' })");
    expect(source).toContain("t('recommendedFix.resolved.title', { defaultValue: 'This discrepancy has been resolved' })");
    expect(source).toContain("t('recommendedFix.resolved.description', {");
    expect(source).toContain("t('recommendedFix.buttons.cancel', { defaultValue: 'Cancel' })");
    expect(source).toContain("t('recommendedFix.buttons.confirm', { defaultValue: 'Apply Fix' })");

    const pseudoKeys = [
      'recommendedFix.title',
      'recommendedFix.panels.recommendedFix',
      'recommendedFix.panels.alternativeFix',
      'recommendedFix.panels.customAdjustment',
      'recommendedFix.panels.noActionRequired',
      'recommendedFix.buttons.createTrackingEntry',
      'recommendedFix.buttons.updateRemainingAmount',
      'recommendedFix.buttons.applyAdjustment',
      'recommendedFix.buttons.markResolvedNoAction',
      'recommendedFix.buttons.cancel',
      'recommendedFix.buttons.confirm',
      'recommendedFix.dialog.adjustmentAmount',
      'recommendedFix.dialog.notes',
      'recommendedFix.impactSummary.title',
      'recommendedFix.impactSummary.currentBalance',
      'recommendedFix.impactSummary.newBalance',
      'recommendedFix.resolved.title',
      'recommendedFix.resolved.description',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

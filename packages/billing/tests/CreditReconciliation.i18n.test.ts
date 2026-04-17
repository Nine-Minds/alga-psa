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

describe('CreditReconciliation i18n wiring contract', () => {
  it('T017: CreditReconciliation translates the dashboard header, filter controls, and stats entry points', () => {
    const source = read('../src/components/billing-dashboard/CreditReconciliation.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('reconciliation.title', { defaultValue: 'Credit Reconciliation Dashboard' })");
    expect(source).toContain("t('reconciliation.selectClient', { defaultValue: 'Select Client' })");
    expect(source).toContain("t('reconciliation.status', { defaultValue: 'Status' })");
    expect(source).toContain("t('reconciliation.allStatuses', { defaultValue: 'All Statuses' })");
    expect(source).toContain("t('reconciliation.fromDate', { defaultValue: 'From Date' })");
    expect(source).toContain("t('reconciliation.toDate', { defaultValue: 'To Date' })");
    expect(source).toContain("t('stats.totalDiscrepancies', { defaultValue: 'Total Discrepancies' })");
  });

  it('T018: CreditReconciliation translates report charts, table columns, tabs, badges, and row actions', () => {
    const source = read('../src/components/billing-dashboard/CreditReconciliation.tsx');

    expect(source).toContain("t('charts.statusDistribution', { defaultValue: 'Status Distribution' })");
    expect(source).toContain("t('charts.discrepancyTrends', { defaultValue: 'Discrepancy Trends' })");
    expect(source).toContain("t('columns.client', { defaultValue: 'Client' })");
    expect(source).toContain("t('columns.discrepancy', { defaultValue: 'Discrepancy' })");
    expect(source).toContain("t('columns.expectedBalance', { defaultValue: 'Expected Balance' })");
    expect(source).toContain("t('status.open', { defaultValue: 'Open' })");
    expect(source).toContain("t('status.inReview', { defaultValue: 'In Review' })");
    expect(source).toContain("t('status.resolved', { defaultValue: 'Resolved' })");
    expect(source).toContain("t('actions.view', { defaultValue: 'View' })");
    expect(source).toContain("t('actions.resolve', { defaultValue: 'Resolve' })");
    expect(source).toContain("t('reconciliation.tabs.all', { defaultValue: 'All' })");
    expect(source).toContain("t('reconciliation.tabs.resolved', { defaultValue: 'Resolved' })");
  });

  it('T019: CreditReconciliation toast message uses translated interpolation placeholders for validation counts', () => {
    const source = read('../src/components/billing-dashboard/CreditReconciliation.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );

    expect(source).toContain("t('reconciliation.validationResult', {");
    expect(getLeaf(en, 'reconciliation.validationResult')).toBe(
      'Validation completed: Found {{balanceCount}} balance discrepancies and {{trackingCount}} tracking issues.',
    );
  });

  it('T020: xx pseudo-locale backs representative CreditReconciliation dashboard and reporting keys', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    const pseudoKeys = [
      'reconciliation.title',
      'reconciliation.selectClient',
      'reconciliation.status',
      'reconciliation.allStatuses',
      'stats.totalDiscrepancies',
      'stats.totalDiscrepancyAmount',
      'stats.openIssues',
      'charts.statusDistribution',
      'charts.discrepancyTrends',
      'reconciliation.reconciliationReports',
      'reconciliation.tabs.open',
      'status.resolved',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

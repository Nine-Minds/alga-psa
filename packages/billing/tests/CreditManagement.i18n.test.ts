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

describe('CreditManagement i18n wiring contract', () => {
  it('T013: CreditManagement translates dashboard headings, stat labels, and table columns via msp/credits', () => {
    const source = read('../src/components/billing-dashboard/CreditManagement.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('management.title', { defaultValue: 'Credit Management' })");
    expect(source).toContain("t('charts.expirationSummary', { defaultValue: 'Credit Expiration Summary' })");
    expect(source).toContain("t('charts.usageTrends', { defaultValue: 'Credit Usage Trends' })");
    expect(source).toContain("t('stats.totalActiveCredits', { defaultValue: 'Total Active Credits' })");
    expect(source).toContain("t('stats.expiringIn30Days', { defaultValue: 'Expiring in 30 Days' })");
    expect(source).toContain("t('columns.creditId', { defaultValue: 'Credit ID' })");
    expect(source).toContain("t('columns.created', { defaultValue: 'Created' })");
    expect(source).toContain("t('columns.description', { defaultValue: 'Description' })");
    expect(source).toContain("t('columns.context', { defaultValue: 'Context' })");
    expect(source).toContain("t('columns.status', { defaultValue: 'Status' })");
  });

  it('T014: CreditManagement translates chart legend labels and placeholder chart month labels', () => {
    const source = read('../src/components/billing-dashboard/CreditManagement.tsx');

    expect(source).toContain("t('charts.creditsIssued', { defaultValue: 'Credits Issued' })");
    expect(source).toContain("t('charts.creditsApplied', { defaultValue: 'Credits Applied' })");
    expect(source).toContain("t('charts.creditsExpired', { defaultValue: 'Credits Expired' })");
    expect(source).toContain("t('charts.months.jan', { defaultValue: 'Jan' })");
    expect(source).toContain("t('charts.months.jun', { defaultValue: 'Jun' })");
  });

  it('T015: CreditManagement renderCreditContext helper resolves lineage and service-period text through msp/credits', () => {
    const source = read('../src/components/billing-dashboard/CreditManagement.tsx');

    expect(source).toContain("t('context.lineageMissing', { defaultValue: 'Lineage Missing' })");
    expect(source).toContain("t('context.transferredRecurringCredit', { defaultValue: 'Transferred Recurring Credit' })");
    expect(source).toContain("t('context.recurringSource', { defaultValue: 'Recurring Source' })");
    expect(source).toContain("t('context.servicePeriod', {");
    expect(source).toContain("t('context.financialOnly', { defaultValue: 'Financial Only' })");
    expect(source).toContain("t('context.noRecurringServicePeriod', { defaultValue: 'No recurring service period' })");
  });

  it('T016: xx pseudo-locale backs representative CreditManagement page, chart, table, and context keys', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    const pseudoKeys = [
      'management.title',
      'charts.expirationSummary',
      'charts.usageTrends',
      'stats.totalActiveCredits',
      'stats.totalCreditsApplied',
      'management.recentCredits',
      'tabs.activeCredits',
      'tabs.expiredCredits',
      'actions.viewAllCredits',
      'context.lineageMissing',
      'context.financialOnly',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

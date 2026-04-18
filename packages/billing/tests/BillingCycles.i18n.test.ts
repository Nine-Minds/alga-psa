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

describe('BillingCycles i18n wiring contract', () => {
  it('T021: title, tooltip, table headers, filters, and view-action link resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/BillingCycles.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'billingCycles.title',
      'billingCycles.tooltip',
      'billingCycles.description',
      'billingCycles.searchPlaceholder',
      'billingCycles.dateRange',
      'billingCycles.search',
      'billingCycles.loading',
      'billingCycles.errors.loadFailed',
      'billingCycles.columns.client',
      'billingCycles.columns.contract',
      'billingCycles.columns.currentBillingCycle',
      'billingCycles.columns.anchor',
      'billingCycles.columns.actions',
      'billingCycles.actions.viewClientBilling',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T022: month names, cycle labels, anchor formats, and empty-state fallbacks resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/BillingCycles.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'billingCycles.values.noActiveAssignments',
      'billingCycles.values.unknown',
      'billingCycles.values.assignmentId',
      'billingCycles.values.notSet',
      'billingCycles.values.rolling',
      'billingCycles.values.weekday',
      'billingCycles.values.starts',
      'billingCycles.values.day',
      'billingCycles.values.monthDay',
      'billingCycles.values.dash',
      'billingCycles.cycles.',
      'billingCycles.months.',
    ];
    const localeKeyChecks = [
      'billingCycles.values.noActiveAssignments',
      'billingCycles.values.unknown',
      'billingCycles.values.assignmentId',
      'billingCycles.values.notSet',
      'billingCycles.values.rolling',
      'billingCycles.values.weekday',
      'billingCycles.values.starts',
      'billingCycles.values.day',
      'billingCycles.values.monthDay',
      'billingCycles.values.dash',
      'billingCycles.cycles.weekly',
      'billingCycles.cycles.bi-weekly',
      'billingCycles.cycles.monthly',
      'billingCycles.cycles.quarterly',
      'billingCycles.cycles.semi-annually',
      'billingCycles.cycles.annually',
      'billingCycles.months.january',
      'billingCycles.months.february',
      'billingCycles.months.march',
      'billingCycles.months.april',
      'billingCycles.months.may',
      'billingCycles.months.june',
      'billingCycles.months.july',
      'billingCycles.months.august',
      'billingCycles.months.september',
      'billingCycles.months.october',
      'billingCycles.months.november',
      'billingCycles.months.december',
    ];

    expect(source).toContain('formatAnchorSummary');
    expect(source).toContain('formatBillingCycle');

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

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

describe('Overview i18n wiring contract', () => {
  it('T025: wires the seven metric card titles and subtitles through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/Overview.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('overview.metrics.activeContractLines.title', { defaultValue: 'Active Contract Lines' })");
    expect(source).toContain("t('overview.metrics.billingClients.title', { defaultValue: 'Billing Clients' })");
    expect(source).toContain("t('overview.metrics.monthlyRevenue.title', { defaultValue: 'Monthly Revenue' })");
    expect(source).toContain("t('overview.metrics.activeServices.title', { defaultValue: 'Active Services' })");
    expect(source).toContain("t('overview.metrics.outstandingAmount.title', { defaultValue: 'Outstanding Amount' })");
    expect(source).toContain("t('overview.metrics.creditBalance.title', { defaultValue: 'Credit Balance' })");
    expect(source).toContain("t('overview.metrics.pendingApprovals.title', { defaultValue: 'Pending Approvals' })");
    expect(source).toContain("t('overview.metrics.billingClients.subtitle', { defaultValue: 'Total Clients' })");
    expect(source).toContain("t('overview.metrics.monthlyRevenue.subtitle', { defaultValue: 'Current Month' })");
    expect(source).toContain("t('overview.metrics.activeServices.subtitle', { defaultValue: 'In Catalog' })");
    expect(source).toContain("t('overview.metrics.outstandingAmount.subtitle', { defaultValue: 'Unpaid Invoices' })");
    expect(source).toContain("t('overview.metrics.creditBalance.subtitle', { defaultValue: 'Total Credits' })");
    expect(source).toContain("t('overview.metrics.pendingApprovals.subtitle', { defaultValue: 'Time Entries' })");
    expect(source).toContain("t('overview.sections.monthlyActivity.title', { defaultValue: 'Monthly Activity' })");
    expect(source).toContain("t('overview.sections.monthlyActivity.subtitle', { defaultValue: 'Billable hours this month' })");
  });

  it('T026: wires the feature card titles and descriptions, service catalog section, and load-error alerts through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/Overview.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('overview.features.paymentProcessing.title', { defaultValue: 'Payment Processing' })");
    expect(source).toContain("t('overview.features.billingCycles.title', { defaultValue: 'Billing Cycles' })");
    expect(source).toContain("t('overview.features.servicePeriods.title', { defaultValue: 'Service Periods' })");
    expect(source).toContain("t('overview.features.invoiceManagement.title', { defaultValue: 'Invoice Management' })");
    expect(source).toContain("t('overview.features.overduePayments.title', { defaultValue: 'Overdue Payments' })");
    expect(source).toContain("t('overview.features.serviceCatalog.title', { defaultValue: 'Service Catalog' })");
    expect(source).toContain("t('overview.sections.serviceCatalog.title', { defaultValue: 'Service Catalog Management' })");
    expect(source).toContain("t('overview.sections.serviceCatalog.button', { defaultValue: 'Manage Service Catalog' })");
    expect(source).toContain("t('overview.errors.loadData', { defaultValue: 'Failed to load billing data' })");
    expect(source).toContain("t('overview.errors.loadTitle', { defaultValue: 'Unable to load billing data' })");
    expect(source).toContain("t('overview.states.ellipsis', { defaultValue: '...' })");
    expect(source).toContain("t('overview.states.error', { defaultValue: 'Error' })");
    expect(source).toContain("t('overview.states.zero', { defaultValue: '0' })");
    expect(source).toContain("t('overview.states.zeroHours', { defaultValue: '0 hours' })");

    const pseudoKeys = [
      'overview.metrics.activeContractLines.title',
      'overview.metrics.billingClients.title',
      'overview.metrics.monthlyRevenue.title',
      'overview.metrics.activeServices.title',
      'overview.metrics.outstandingAmount.title',
      'overview.metrics.creditBalance.title',
      'overview.metrics.pendingApprovals.title',
      'overview.features.paymentProcessing.title',
      'overview.features.billingCycles.title',
      'overview.features.servicePeriods.title',
      'overview.features.invoiceManagement.title',
      'overview.features.overduePayments.title',
      'overview.features.serviceCatalog.title',
      'overview.sections.monthlyActivity.title',
      'overview.sections.serviceCatalog.title',
      'overview.sections.serviceCatalog.button',
      'overview.errors.loadTitle',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

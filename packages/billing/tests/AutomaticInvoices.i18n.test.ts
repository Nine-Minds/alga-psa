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

describe('AutomaticInvoices i18n wiring contract', () => {
  it('T003: ready-to-invoice chrome uses msp/invoicing keys for title, descriptions, filters, and table headers', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(source).toContain("const { t } = useTranslation('msp/invoicing');");

    const keyChecks = [
      'automaticInvoices.ready.title',
      'automaticInvoices.ready.description',
      'automaticInvoices.ready.selectAllExplanation',
      'automaticInvoices.ready.dateRange',
      'automaticInvoices.ready.search',
      'automaticInvoices.ready.filterPlaceholder',
      'automaticInvoices.ready.columns.group',
      'automaticInvoices.ready.columns.servicePeriod',
      'automaticInvoices.ready.columns.invoiceWindow',
      'automaticInvoices.ready.columns.included',
      'automaticInvoices.actions.previewSelected',
      'automaticInvoices.actions.generateSelected',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T004: parent-group counts, combinability badges, and incompatibility reasons resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const directKeyChecks = [
      'automaticInvoices.groups.item',
      'automaticInvoices.groups.contract',
      'automaticInvoices.groups.line',
    ];

    const namespaceKeyChecks = [
      'automaticInvoices.groups.canCombine',
      'automaticInvoices.groups.separate',
      'automaticInvoices.groups.blocked',
      'automaticInvoices.groups.notReady',
      'automaticInvoices.incompatibilityReasons.invoiceWindowDiffers',
      'automaticInvoices.incompatibilityReasons.clientDiffers',
      'automaticInvoices.incompatibilityReasons.poScopeDiffers',
      'automaticInvoices.incompatibilityReasons.currencyDiffers',
      'automaticInvoices.incompatibilityReasons.taxTreatmentDiffers',
      'automaticInvoices.incompatibilityReasons.exportShapeDiffers',
    ];

    expect(source).toContain('AUTOMATIC_INVOICE_GROUP_LABELS');
    expect(source).toContain('AUTOMATIC_INVOICE_INCOMPATIBILITY_LABELS');
    expect(source).toContain('t(`automaticInvoices.groups.${record.parentSummary.combinabilitySummaryKey}`');
    expect(source).toContain('t(`automaticInvoices.incompatibilityReasons.${reasonKey}`');

    for (const key of directKeyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    for (const key of namespaceKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T005: child execution rows resolve cadence, billing timing, assignment context, pending amount, and blocker copy through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'automaticInvoices.executionRows.labels.cadence',
      'automaticInvoices.executionRows.labels.billingTiming',
      'automaticInvoices.executionRows.labels.servicePeriod',
      'automaticInvoices.executionRows.pendingAmount',
      'automaticInvoices.executionRows.attributionWarning',
      'automaticInvoices.executionRows.blockedUntilApproval',
      'automaticInvoices.executionRows.assignmentContext.unresolvedTimeEntry',
      'automaticInvoices.executionRows.assignmentContext.unresolvedUsageRecord',
      'automaticInvoices.executionRows.assignmentContext.assignedContractLine',
      'automaticInvoices.executionRows.assignmentContext.assignedWorkItem',
      'automaticInvoices.executionRows.assignmentContext.unresolvedWork',
      'automaticInvoices.history.badges.contractAnniversary',
      'automaticInvoices.history.badges.clientSchedule',
      'recurringServicePeriods.values.advance',
      'recurringServicePeriods.values.arrears',
    ];

    expect(source).toContain('translateAssignmentContext');
    expect(source).toContain('formatBlockedReason');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

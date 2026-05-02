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
      'automaticInvoices.groups.ready',
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

  it('T006/T007/T008: reverse, preview, delete, and PO-overage dialog copy resolves through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'automaticInvoices.actions.reverseInvoice',
      'automaticInvoices.actions.deleteInvoice',
      'automaticInvoices.actions.closePreview',
      'automaticInvoices.actions.generateInvoice',
      'automaticInvoices.dialogs.reverse.title',
      'automaticInvoices.dialogs.reverse.warningTitle',
      'automaticInvoices.dialogs.reverse.description',
      'automaticInvoices.dialogs.reverse.impactTitle',
      'automaticInvoices.dialogs.reverse.effects.deleteDraft',
      'automaticInvoices.dialogs.reverse.effects.reissueCredits',
      'automaticInvoices.dialogs.reverse.effects.unmarkRecords',
      'automaticInvoices.dialogs.reverse.effects.retireBridge',
      'automaticInvoices.dialogs.reverse.effects.reopenPeriods',
      'automaticInvoices.dialogs.reverse.confirm',
      'automaticInvoices.dialogs.delete.title',
      'automaticInvoices.dialogs.delete.message',
      'automaticInvoices.dialogs.preview.title',
      'automaticInvoices.dialogs.preview.description',
      'automaticInvoices.dialogs.preview.summaryCombined',
      'automaticInvoices.dialogs.preview.summarySeparate',
      'automaticInvoices.dialogs.preview.columns.description',
      'automaticInvoices.dialogs.preview.columns.quantity',
      'automaticInvoices.dialogs.preview.columns.rate',
      'automaticInvoices.dialogs.preview.columns.amount',
      'automaticInvoices.dialogs.preview.totals.subtotal',
      'automaticInvoices.dialogs.preview.totals.tax',
      'automaticInvoices.dialogs.preview.totals.total',
      'automaticInvoices.dialogs.poOverage.title',
      'automaticInvoices.dialogs.poOverage.batchDescription',
      'automaticInvoices.dialogs.poOverage.batchItem',
      'automaticInvoices.dialogs.poOverage.allowOverages',
      'automaticInvoices.dialogs.poOverage.skipInvoices',
      'automaticInvoices.dialogs.poOverage.singleDescription',
      'automaticInvoices.dialogs.poOverage.proceedConfirm',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T009: recurring history chrome resolves headers, filter input, cadence badges, and row-menu copy through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'automaticInvoices.history.title',
      'automaticInvoices.history.filterPlaceholder',
      'automaticInvoices.history.columns.client',
      'automaticInvoices.history.columns.assignmentScope',
      'automaticInvoices.history.columns.cadenceSource',
      'automaticInvoices.history.columns.servicePeriod',
      'automaticInvoices.history.columns.invoiceWindow',
      'automaticInvoices.history.columns.invoice',
      'automaticInvoices.history.columns.actions',
      'automaticInvoices.history.badges.contractAnniversary',
      'automaticInvoices.history.badges.clientSchedule',
      'automaticInvoices.history.badges.multiContractInvoice',
      'automaticInvoices.history.badges.servicePeriodBacked',
      'common.actions.openMenu',
    ];

    expect(source).toContain('formatCadenceSourceText(record.cadenceSource)');
    expect(source).toContain("formatDate(record.invoiceDate)");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T010: materialization-gap panel and recurring-history error/loading copy resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'automaticInvoices.materializationGap.title',
      'automaticInvoices.materializationGap.description',
      'automaticInvoices.materializationGap.labels.servicePeriod',
      'automaticInvoices.materializationGap.labels.invoiceWindow',
      'automaticInvoices.materializationGap.labels.scheduleKey',
      'automaticInvoices.materializationGap.reviewLink',
      'automaticInvoices.materializationGap.helpText',
      'automaticInvoices.errors.title',
      'automaticInvoices.errors.loadReady',
      'automaticInvoices.errors.loadHistory',
      'automaticInvoices.loading.billingData',
      'common.labels.unknownClient',
      'common.actions.retry',
      'common.actions.close',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T051: remaining approval/ready-table chrome resolves through msp/invoicing for approval panels, selection hints, unknown fallbacks, metadata plural copy, and PO fallback labels', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'automaticInvoices.ready.groupedPreviewUnavailable',
      'automaticInvoices.ready.selectionHintCombined',
      'automaticInvoices.ready.selectionHintSeparate',
      'automaticInvoices.ready.needsApproval.title',
      'automaticInvoices.ready.needsApproval.description',
      'automaticInvoices.ready.needsApproval.labels.servicePeriod',
      'automaticInvoices.ready.needsApproval.labels.invoiceWindow',
      'automaticInvoices.ready.needsApproval.unapprovedEntries',
      'automaticInvoices.ready.needsApproval.actions.reviewApprovals',
      'automaticInvoices.groups.obligationCount',
      'automaticInvoices.groups.includedCount',
      'automaticInvoices.groups.attributionMetadataMissing',
      'automaticInvoices.groups.actions.expand',
      'automaticInvoices.groups.actions.collapse',
      'automaticInvoices.history.badges.unknownCadenceSource',
      'purchaseOrder.labels.short',
      'automaticInvoices.dialogs.poOverage.poNumber',
    ];

    expect(source).toContain('formatPoLabel');
    expect(source).toContain('formatBlockedReason(record.parentSummary.blockedReason)');
    expect(source).toContain("t('common.labels.unknownClient'");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

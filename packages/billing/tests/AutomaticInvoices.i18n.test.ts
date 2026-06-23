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

    // Pro-Grid redesign + cleanup: the static description/select-all explanation
    // and page-scope note were dropped; columns are now Client/Group, Status,
    // Service Period, Amount. Charge moved to an inline tag on the client cell
    // (chargeTags.*), and Service Period + Invoice Window collapsed into one
    // column (the open date now rides on the Status pill).
    const keyChecks = [
      'automaticInvoices.ready.title',
      'automaticInvoices.ready.dateRange',
      'automaticInvoices.ready.search',
      'automaticInvoices.ready.filterPlaceholder',
      'automaticInvoices.ready.columns.group',
      'automaticInvoices.ready.columns.status',
      'automaticInvoices.ready.columns.servicePeriod',
      'automaticInvoices.ready.columns.amount',
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

    // Single-charge groups name their contract line; only multi-charge groups
    // render a count ('groups.item'). The per-contract / per-line count chips
    // were removed to avoid the redundant "1 line item · 1 contract · 1 line".
    const directKeyChecks = [
      'automaticInvoices.groups.item',
    ];

    const namespaceKeyChecks = [
      // combinabilitySummaryKey domain (backs resolveStatusKey)
      'automaticInvoices.groups.ready',
      'automaticInvoices.groups.canCombine',
      'automaticInvoices.groups.separate',
      'automaticInvoices.groups.blocked',
      'automaticInvoices.groups.notReady',
      // Pro-Grid status pill labels (what the grid actually renders)
      'automaticInvoices.status.ready',
      'automaticInvoices.status.combine',
      'automaticInvoices.status.separate',
      'automaticInvoices.status.notYetDue',
      'automaticInvoices.status.approval',
      'automaticInvoices.status.blocked',
      'automaticInvoices.incompatibilityReasons.invoiceWindowDiffers',
      'automaticInvoices.incompatibilityReasons.clientDiffers',
      'automaticInvoices.incompatibilityReasons.poScopeDiffers',
      'automaticInvoices.incompatibilityReasons.currencyDiffers',
      'automaticInvoices.incompatibilityReasons.taxTreatmentDiffers',
      'automaticInvoices.incompatibilityReasons.exportShapeDiffers',
    ];

    expect(source).toContain('AUTOMATIC_INVOICE_GROUP_LABELS');
    expect(source).toContain('AUTOMATIC_INVOICE_INCOMPATIBILITY_LABELS');
    // The combinability badge resolves through the status pill, which maps a
    // resolved status key to STATUS_PILL_META[key].labelKey (automaticInvoices.status.*).
    expect(source).toContain('STATUS_PILL_META');
    expect(source).toContain('resolveStatusKey');
    expect(source).toContain('t(meta.labelKey, { defaultValue: meta.default })');
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

    // Pro-Grid redesign flattened the child row: cadence + billing timing render
    // inline (formatCadenceSourceBadge + recurringServicePeriods.values.*), and the
    // per-field "Cadence/Billing timing/Service period" labels and pendingAmount copy
    // were dropped (service period and amount are their own columns now).
    const keyChecks = [
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

    // Pro-Grid redesign: the inline selection hints became the sticky
    // selection-bar summary (summary.* / filters.countSummary), and the
    // per-period obligation/included counts were removed (the client cell names
    // a single line, or counts multiple via groups.item).
    const keyChecks = [
      'automaticInvoices.ready.groupedPreviewUnavailable',
      'automaticInvoices.summary.empty',
      'automaticInvoices.filters.countSummary',
      'automaticInvoices.ready.needsApproval.title',
      'automaticInvoices.ready.needsApproval.description',
      'automaticInvoices.ready.needsApproval.labels.servicePeriod',
      'automaticInvoices.ready.needsApproval.labels.invoiceWindow',
      'automaticInvoices.ready.needsApproval.unapprovedEntries',
      'automaticInvoices.ready.needsApproval.actions.reviewApprovals',
      'automaticInvoices.groups.attributionMetadataMissing',
      'automaticInvoices.groups.actions.expand',
      'automaticInvoices.groups.actions.collapse',
      'automaticInvoices.history.badges.unknownCadenceSource',
      'purchaseOrder.labels.short',
      'automaticInvoices.dialogs.poOverage.poNumber',
    ];

    expect(source).toContain('formatPoLabel');
    expect(source).toContain('formatBlockedReason(group.parentSummary.blockedReason)');
    expect(source).toContain("t('common.labels.unknownClient'");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

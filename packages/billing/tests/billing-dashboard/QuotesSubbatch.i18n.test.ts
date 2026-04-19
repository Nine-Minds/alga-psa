// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'),
  ) as T;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('Quotes i18n wiring contract', () => {
  it('T001: english quotes namespace exposes the planned top-level groups', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(Object.keys(en)).toEqual([
      'common',
      'quotesTab',
      'quoteForm',
      'quoteDetail',
      'quoteLineItems',
      'quoteRecipients',
      'quoteConversion',
      'quoteApproval',
      'quoteTemplates',
      'quotePreview',
      'templateEditor',
      'templatesPage',
    ]);
  });

  it('T003: QuoteForm uses msp/quotes translation keys for form chrome, workflow actions, and dialogs', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteForm.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quoteForm.headings.editQuote',
      'quoteForm.headings.newTemplate',
      'common.actions.submitForApproval',
      'quoteForm.actions.cancelQuote',
      'quoteForm.actions.convertToBoth',
      'quoteForm.fields.createFromTemplate',
      'quoteForm.fields.recipients',
      'quoteForm.dialogs.send.title',
      'quoteForm.dialogs.approval.approveTitle',
      'quoteForm.dialogs.conversion.title',
      'quoteForm.notices.sent',
      'quoteForm.errors.save',
      'quoteForm.validation.clientRequired',
      'common.labels.quoteLayout',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T004: QuoteForm no longer renders bare English JSX literals for form labels, actions, or dialog copy', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteForm.tsx');

    const residualPatterns = [
      /text="Loading quote form\.\.\."/,
      />Quote Accepted</,
      />Quote Rejected</,
      />Quote Converted</,
      />Submit for Approval</,
      />Send to Client</,
      />Cancel Quote</,
      />Convert to Contract</,
      />Convert to Invoice</,
      />Convert to Both</,
      />Create New Revision</,
      />Title</,
      />Description \/ Scope</,
      /placeholder="Select client"/,
      /placeholder="Select contact"/,
      /placeholder="Select currency"/,
      /title="Send Quote to Client"/,
      />Recipients</,
      />Additional email addresses \(comma-separated\)</,
      />Message \(optional\)</,
      />Approve Quote</,
      />Request Changes</,
      />Conversion Preview</,
      />Contract Items</,
      />Invoice Items</,
      />Excluded Items</,
      />Will Become Contract Lines</,
      />Will Become Invoice Charges</,
      />Excluded from Conversion</,
      /text="Loading conversion preview\.\.\."/,
    ];

    for (const pattern of residualPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('T005: QuoteDetail uses msp/quotes translation keys for sections, actions, dialogs, and line-item badges', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quoteDetail.sections.quoteLayout',
      'quoteDetail.sections.versionHistory',
      'quoteDetail.sections.activityLog',
      'quoteDetail.actions.backToQuotes',
      'quoteDetail.actions.openConvertedContract',
      'quoteDetail.alerts.clientConfigurationSubmitted',
      'quoteDetail.clientSelections.selectedOptionalItem',
      'quoteDetail.dialogs.approval.approveDescription',
      'quoteDetail.dialogs.send.message',
      'quoteDetail.errors.load',
      'quoteDetail.notices.templateAssigned',
      'quoteDetail.preview.loading',
      'quoteDetail.table.description',
      'quoteDetail.labels.phase',
      'quoteForm.dialogs.conversion.title',
      'quoteConversion.sections.willBecomeInvoiceCharges',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T006: QuoteDetail no longer renders bare English JSX literals for headings, actions, dialogs, or table labels', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteDetail.tsx');

    const residualPatterns = [
      /text="Loading quote details\.\.\."/,
      />Back to Quotes</,
      />Quote Detail</,
      />Back</,
      />Preview</,
      />Download PDF</,
      />Open Converted Contract</,
      />Open Converted Invoice</,
      />Quote Layout</,
      />Version History</,
      />Scope of Work</,
      />Quote Accepted</,
      />Quote Rejected</,
      />Line Items</,
      />Client Configuration Submitted</,
      />Description</,
      />Billing</,
      />Unit Price</,
      />Client Notes</,
      />Internal Notes</,
      />Activity Log</,
      />Conversion Preview</,
      />Contract Items</,
      />Invoice Items</,
      />Excluded Items</,
      />Quote Preview</,
      />Close</,
      />Send Quote to Client</,
      />Recipients</,
      />Optional message to include in the email</,
      />Approve Quote</,
      />Request Changes</,
    ];

    for (const pattern of residualPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('T007: QuotesTab uses msp/quotes translation keys for tabs, table chrome, row actions, and dialogs', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuotesTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quotesTab.title',
      'quotesTab.tabs.active',
      'quotesTab.tabs.approval',
      'quotesTab.actions.quoteActions',
      'quotesTab.filters.client',
      'quotesTab.filters.allClients',
      'quotesTab.empty.byCategory',
      'quotesTab.dialogs.delete.title',
      'quotesTab.dialogs.send.title',
      'quotesTab.dialogs.send.additionalRecipients',
      'quotesTab.dialogs.send.messagePlaceholder',
      'quotesTab.errors.load',
      'quotesTab.loading',
      'common.columns.quoteNumber',
      'common.columns.actions',
      'common.actions.newQuote',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T008: QuotesTab no longer renders bare English JSX literals for tabs, table labels, menus, or dialogs', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuotesTab.tsx');

    const residualPatterns = [
      /text="Loading quotes\.\.\."/,
      />Quotes</,
      />New Quote</,
      />Open</,
      />Send to Client</,
      />Resend</,
      />Send Reminder</,
      />Download PDF</,
      />Duplicate</,
      />Delete</,
      />Client</,
      />All clients</,
      />Approval Queue</,
      />Send Quote</,
      />Additional recipients \(comma-separated\)</,
      />Message \(optional\)</,
      /placeholder="email@example\.com, another@example\.com"/,
      />Add a personal note for the recipient\.\.\.</,
    ];

    for (const pattern of residualPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('T009: QuoteDocumentTemplateEditor uses msp/quotes translation keys for editor chrome, preview pipeline, and footer metadata', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteDocumentTemplateEditor.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'templateEditor.title',
      'templateEditor.headings.newLayout',
      'templateEditor.actions.backToLayouts',
      'templateEditor.actions.saveLayout',
      'templateEditor.fields.layoutDetails',
      'templateEditor.fields.templateName',
      'templateEditor.tabs.visual',
      'templateEditor.tabs.preview',
      'templateEditor.preview.sampleScenario',
      'templateEditor.preview.selectScenarioPrompt',
      'templateEditor.pipeline.shape',
      'templateEditor.actions.rerun',
      'templateEditor.codeReadonly',
      'templateEditor.footer.created',
      'templateEditor.errors.saveFailed',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T010: QuoteDocumentTemplateEditor no longer renders bare English JSX literals for editor chrome or preview status copy', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteDocumentTemplateEditor.tsx');

    const residualPatterns = [
      />New Quote Layout</,
      />Edit Quote Layout</,
      />Back to Layouts</,
      />Save Layout</,
      />Layout Details</,
      />Template Name</,
      />Version</,
      />Visual</,
      />Code</,
      />Design</,
      />Transforms</,
      />Preview</,
      />Sample Scenario</,
      /placeholder="Select scenario\.\.\."/,
      />Shape</,
      />Render</,
      />Re-run</,
      />Select a sample scenario to generate an authoritative preview\.</,
      />Shaping and rendering preview\.\.\.</,
      />Code view is generated from the Visual workspace and is read-only\.</,
      />Created:</,
      />Last Updated:</,
    ];

    for (const pattern of residualPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('T011: QuoteLineItemsEditor uses msp/quotes keys plus shared billing-frequency hooks for line-item chrome', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteLineItemsEditor.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");
    expect(source).toContain("import { useBillingFrequencyOptions, useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';");
    expect(source).toContain('const billingFrequencyOptions = useBillingFrequencyOptions();');
    expect(source).toContain('const formatBillingFrequency = useFormatBillingFrequency();');

    const keyChecks = [
      'quoteLineItems.title',
      'quoteLineItems.columns.move',
      'quoteLineItems.columns.unitPrice',
      'quoteLineItems.labels.phaseSection',
      'quoteLineItems.labels.optional',
      'quoteLineItems.labels.recurring',
      'quoteLineItems.actions.addDiscount',
      'quoteLineItems.actions.hideDiscount',
      'quoteLineItems.discounts.percentage',
      'quoteLineItems.discounts.fixed',
      'quoteLineItems.discounts.targets.namedItem',
      'quoteLineItems.placeholders.servicePicker',
      'quoteLineItems.empty',
      'quoteLineItems.actions.remove',
      'quoteLineItems.labels.setPrice',
      'quoteLineItems.labels.noPriceInCurrency',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T012: QuoteLineItemsEditor no longer renders bare English JSX literals for line-item tables, controls, or hints', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteLineItemsEditor.tsx');

    const residualPatterns = [
      />Line Items</,
      /placeholder="Search or type custom item name\.\.\."/,
      />Hide Discount</,
      />Add Discount</,
      />Percentage discount</,
      />Fixed discount</,
      />Whole quote</,
      />Specific item</,
      />Specific service</,
      /placeholder="Select item"/,
      /placeholder="Select service"/,
      />Applies to the full quote subtotal</,
      />No line items yet\. Use the catalog search above to add your first item\.</,
      />Move</,
      />Item</,
      />Billing</,
      />Flags</,
      />Qty</,
      />Unit Price</,
      />Total</,
      />Actions</,
      /label="Optional"/,
      /label="Recurring"/,
      />Phase \/ Section</,
      />Set price</,
      />Remove</,
      />Expand</,
      />Collapse</,
      />Discount</,
      />Markup unavailable</,
      /Markup can't be calculated because cost is tracked in/,
      /% markup</,
    ];

    for (const pattern of residualPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('T013: QuoteDocumentTemplatesPage uses msp/quotes keys for page chrome, table columns, and row actions', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteDocumentTemplatesPage.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'templatesPage.title',
      'templatesPage.description',
      'templatesPage.cards.availableLayouts',
      'templatesPage.actions.openMenu',
      'templatesPage.dialogs.deleteConfirm',
      'templatesPage.labels.custom',
      'templatesPage.errors.load',
      'templatesPage.errors.clone',
      'templatesPage.errors.editCopy',
      'templatesPage.errors.setDefault',
      'templatesPage.errors.delete',
      'common.actions.newLayout',
      'common.actions.edit',
      'common.actions.editAsCopy',
      'common.actions.clone',
      'common.actions.setAsDefault',
      'common.actions.delete',
      'common.columns.name',
      'common.columns.source',
      'common.columns.default',
      'common.columns.actions',
      'common.badges.standard',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T014: QuoteConversionDialog uses msp/quotes keys for dialog copy, mode descriptions, and summary labels', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteConversionDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quoteConversion.title',
      'quoteConversion.description',
      'quoteConversion.loading',
      'quoteConversion.errors.title',
      'quoteConversion.errors.load',
      'quoteConversion.errors.convert',
      'quoteConversion.partial.title',
      'quoteConversion.partial.alreadyConverted',
      'quoteConversion.partial.contractCreated',
      'quoteConversion.partial.invoiceCreated',
      'quoteConversion.partial.remainingItems',
      'quoteConversion.mode.contract.label',
      'quoteConversion.mode.contract.description',
      'quoteConversion.mode.invoice.label',
      'quoteConversion.mode.invoice.description',
      'quoteConversion.mode.both.label',
      'quoteConversion.mode.both.description',
      'quoteConversion.sections.conversionMode',
      'quoteConversion.sections.itemMappingPreview',
      'quoteConversion.sections.contractItems',
      'quoteConversion.sections.invoiceItems',
      'quoteConversion.sections.excludedItems',
      'quoteConversion.sections.quoteTotal',
      'quoteConversion.sections.statusAfterConversion',
      'quoteConversion.summary.fixed',
      'quoteConversion.summary.discount',
      'quoteConversion.summary.converted',
      'quoteConversion.actions.converting',
      'quoteConversion.actions.convertQuote',
      'common.actions.cancel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T015: QuoteApprovalDashboard uses msp/quotes keys for page labels, filters, loading/empty states, and table columns', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteApprovalDashboard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");
    expect(source).toContain('const { formatCurrency, formatDate } = useFormatters();');

    const keyChecks = [
      'quoteApproval.title',
      'quoteApproval.description',
      'quoteApproval.settings.label',
      'quoteApproval.settings.enabled',
      'quoteApproval.settings.disabled',
      'quoteApproval.filters.status',
      'quoteApproval.filters.pendingApproval',
      'quoteApproval.filters.approved',
      'quoteApproval.actions.backToQuotes',
      'quoteApproval.loading',
      'quoteApproval.empty.title',
      'quoteApproval.empty.pendingApproval',
      'quoteApproval.empty.approved',
      'quoteApproval.errors.load',
      'quoteApproval.errors.settings',
      'common.columns.quoteNumber',
      'common.columns.client',
      'common.columns.title',
      'common.columns.amount',
      'common.columns.status',
      'common.columns.quoteDate',
      'common.columns.validUntil',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T016: QuoteTemplatesList uses msp/quotes keys for list chrome, empty/loading states, and delete confirmation', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteTemplatesList.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");
    expect(source).toContain('const { formatCurrency, formatDate } = useFormatters();');

    const keyChecks = [
      'quoteTemplates.title',
      'quoteTemplates.description',
      'quoteTemplates.loading',
      'quoteTemplates.empty.inline',
      'quoteTemplates.actions.templateActions',
      'quoteTemplates.actions.editTemplate',
      'quoteTemplates.actions.createQuoteFromTemplate',
      'quoteTemplates.actions.delete',
      'quoteTemplates.dialogs.delete.title',
      'quoteTemplates.dialogs.delete.message',
      'quoteTemplates.errors.load',
      'quoteTemplates.errors.delete',
      'common.actions.newTemplate',
      'common.actions.delete',
      'common.actions.cancel',
      'common.columns.title',
      'common.columns.items',
      'common.columns.currency',
      'common.columns.created',
      'common.columns.actions',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T017: QuotePreviewPanel uses msp/quotes keys for panel chrome, actions, and empty/loading/error states', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuotePreviewPanel.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quotePreview.title',
      'quotePreview.empty.selectQuote',
      'quotePreview.empty.unavailable',
      'quotePreview.placeholders.selectLayout',
      'quotePreview.loading',
      'quotePreview.actions.openQuote',
      'quotePreview.errors.downloadPdf',
      'quotePreview.errors.load',
      'common.actions.downloadPdf',
      'common.badges.standard',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T029: shared billing-frequency enums expose weekly across constants and all locale files', () => {
    const billingConstants = read('../../src/constants/billing.ts');
    const locales = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'xx', 'yy'];

    expect(billingConstants).toContain("export const BILLING_FREQUENCY_VALUES = ['weekly', 'monthly', 'quarterly', 'annually'] as const;");
    expect(billingConstants).toContain("weekly: 'Weekly'");

    for (const locale of locales) {
      const billing = readJson<Record<string, unknown>>(
        `../../../../server/public/locales/${locale}/features/billing.json`,
      );
      expect(getLeaf(billing, 'enums.billingFrequency.weekly')).toBeDefined();
    }
  });
});

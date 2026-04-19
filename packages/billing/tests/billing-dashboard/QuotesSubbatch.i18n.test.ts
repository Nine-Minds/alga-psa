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
});

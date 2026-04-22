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

describe('SendInvoiceEmailDialog i18n wiring contract', () => {
  it('T033: dialog title, loading state, summary counts, recipients heading, and send/cancel states resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'sendEmail.title',
      'sendEmail.loading',
      'sendEmail.summary.invoices',
      'sendEmail.summary.readyToSend',
      'sendEmail.summary.missingEmail',
      'sendEmail.recipients.title',
      'sendEmail.actions.cancel',
      'sendEmail.actions.send',
      'sendEmail.actions.sendFallback',
      'sendEmail.actions.sending',
    ];

    const localeKeyChecks = [
      'sendEmail.title',
      'sendEmail.loading',
      'sendEmail.summary.invoices_one',
      'sendEmail.summary.invoices_other',
      'sendEmail.summary.readyToSend_one',
      'sendEmail.summary.readyToSend_other',
      'sendEmail.summary.missingEmail_one',
      'sendEmail.summary.missingEmail_other',
      'sendEmail.recipients.title',
      'sendEmail.actions.cancel',
      'sendEmail.actions.sendFallback',
      'sendEmail.actions.send_one',
      'sendEmail.actions.send_other',
      'sendEmail.actions.sending_one',
      'sendEmail.actions.sending_other',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T034: recipient-source labels, no-email fallback, due/additional-message fields, preview text, and send toasts/errors resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'sendEmail.recipients.billingContact',
      'sendEmail.recipients.billingEmail',
      'sendEmail.recipients.clientEmail',
      'sendEmail.recipients.noEmailFound',
      'sendEmail.recipients.notConfigured',
      'sendEmail.fields.due',
      'sendEmail.fields.additionalMessage',
      'sendEmail.fields.additionalMessagePlaceholder',
      'sendEmail.preview',
      'sendEmail.values.defaultFromEmail',
      'sendEmail.values.defaultCompanyName',
      'sendEmail.toasts.noValidRecipients',
      'sendEmail.toasts.sentSuccess',
      'sendEmail.toasts.sentFailure',
      'sendEmail.toasts.sentPartial',
      'sendEmail.errors.loadRecipients',
      'sendEmail.errors.sendFailed',
    ];

    const localePluralChecks = [
      'sendEmail.toasts.sentSuccess_one',
      'sendEmail.toasts.sentSuccess_other',
      'sendEmail.toasts.sentFailure_one',
      'sendEmail.toasts.sentFailure_other',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
    }

    for (const key of [
      'sendEmail.recipients.billingContact',
      'sendEmail.recipients.billingEmail',
      'sendEmail.recipients.clientEmail',
      'sendEmail.recipients.noEmailFound',
      'sendEmail.recipients.notConfigured',
      'sendEmail.fields.due',
      'sendEmail.fields.additionalMessage',
      'sendEmail.fields.additionalMessagePlaceholder',
      'sendEmail.preview',
      'sendEmail.values.defaultFromEmail',
      'sendEmail.values.defaultCompanyName',
      'sendEmail.toasts.noValidRecipients',
      'sendEmail.toasts.sentPartial',
      'sendEmail.errors.loadRecipients',
      'sendEmail.errors.sendFailed',
    ]) {
      expect(getLeaf(en, key)).toBeDefined();
    }

    for (const key of localePluralChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});

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

describe('Credit application and expiration i18n contract', () => {
  it('T021: CreditApplicationUI wires card, column, label, and button copy through msp/credits', () => {
    const source = read('../src/components/billing-dashboard/CreditApplicationUI.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('application.title', { defaultValue: 'Apply Credit' })");
    expect(source).toContain("t('columns.amountAvailable', { defaultValue: 'Amount Available' })");
    expect(source).toContain("t('columns.expiration', { defaultValue: 'Expiration' })");
    expect(source).toContain("t('application.totalAvailableCredit', { defaultValue: 'Total Available Credit:' })");
    expect(source).toContain("t('application.invoiceAmount', { defaultValue: 'Invoice Amount:' })");
    expect(source).toContain("t('application.selectCreditToApply', { defaultValue: 'Select Credit to Apply' })");
    expect(source).toContain("t('application.amountToApply', { defaultValue: 'Amount to Apply' })");
    expect(source).toContain("t('actions.select', { defaultValue: 'Select' })");
    expect(source).toContain("t('actions.selected', { defaultValue: 'Selected' })");
    expect(source).toContain("t('actions.applyCredit', { defaultValue: 'Apply Credit' })");
  });

  it('T022: CreditApplicationUI translates empty/error/help states and is backed by xx pseudo-locale keys', () => {
    const source = read('../src/components/billing-dashboard/CreditApplicationUI.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    expect(source).toContain("t('application.failedToLoadCredits', { defaultValue: 'Failed to load available credits' })");
    expect(source).toContain("t('application.selectCreditError', { defaultValue: 'Please select a credit and enter a valid amount' })");
    expect(source).toContain("t('application.failedToApply', { defaultValue: 'Failed to apply credit' })");
    expect(source).toContain("t('application.noCreditsAvailable', { defaultValue: 'No credits available for this client' })");
    expect(source).toContain("t('application.creditOrderNote', {");

    expect(getLeaf(pseudo, 'application.noCreditsAvailable')).toBe('11111');
    expect(getLeaf(pseudo, 'application.failedToLoadCredits')).toBe('11111');
    expect(getLeaf(pseudo, 'application.failedToApply')).toBe('11111');
  });

  it('T023: CreditExpirationInfo wires card labels and help text through msp/credits', () => {
    const source = read('../src/components/billing-dashboard/CreditExpirationInfo.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('expiration.appliedCredits', { defaultValue: 'Applied Credits' })");
    expect(source).toContain("t('expiration.creditAmount', { defaultValue: 'Credit Amount:' })");
    expect(source).toContain("t('expiration.created', { defaultValue: 'Created:' })");
    expect(source).toContain("t('expiration.expiration', { defaultValue: 'Expiration:' })");
    expect(source).toContain("t('expiration.creditOrderNote', {");
  });

  it('T024: CreditExpirationInfo keeps the applied-amount description as an interpolation key', () => {
    const source = read('../src/components/billing-dashboard/CreditExpirationInfo.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );

    expect(source).toContain("t('expiration.creditsAppliedToInvoice', {");
    expect(getLeaf(en, 'expiration.creditsAppliedToInvoice')).toBe(
      'Credits applied to this invoice: {{amount}}',
    );
  });

  it('T025: CreditExpirationModificationDialog wires title, labels, switch, and button states through msp/credits', () => {
    const source = read('../src/components/billing-dashboard/CreditExpirationModificationDialog.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/credits');");
    expect(source).toContain("t('expirationDialog.title', { defaultValue: 'Modify Credit Expiration' })");
    expect(source).toContain("t('expirationDialog.creditAmount', { defaultValue: 'Credit Amount:' })");
    expect(source).toContain("t('expirationDialog.remainingAmount', { defaultValue: 'Remaining Amount:' })");
    expect(source).toContain("t('expirationDialog.currentExpiration', { defaultValue: 'Current Expiration:' })");
    expect(source).toContain("t('expirationDialog.removeExpiration', { defaultValue: 'Remove expiration date' })");
    expect(source).toContain("t('expirationDialog.newExpirationDate', { defaultValue: 'New Expiration Date' })");
    expect(source).toContain("t('actions.saveChanges', { defaultValue: 'Save Changes' })");
    expect(source).toContain("t('actions.saving', { defaultValue: 'Saving...' })");
  });

  it('T026: CreditExpirationModificationDialog translates validation and generic error copy', () => {
    const source = read('../src/components/billing-dashboard/CreditExpirationModificationDialog.tsx');

    expect(source).toContain("t('expirationDialog.pastDateError', { defaultValue: 'Expiration date cannot be in the past' })");
    expect(source).toContain("t('expirationDialog.updateError', {");
    expect(source).toContain("t('actions.cancel', { defaultValue: 'Cancel' })");
  });
});

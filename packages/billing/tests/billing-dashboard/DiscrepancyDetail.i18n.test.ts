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

describe('DiscrepancyDetail i18n wiring contract', () => {
  it('T007: wires the status badges and back-nav text through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/DiscrepancyDetail.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('discrepancy.backToReconciliation', { defaultValue: 'Back to Reconciliation' })");
    expect(source).toContain("t('discrepancy.status.open', { defaultValue: 'Open' })");
    expect(source).toContain("t('discrepancy.status.inReview', { defaultValue: 'In Review' })");
    expect(source).toContain("t('discrepancy.status.resolved', { defaultValue: 'Resolved' })");
  });

  it('T008: wires the transaction history table headers through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/DiscrepancyDetail.tsx');

    expect(source).toContain("t('discrepancy.tabs.transactionHistory', { defaultValue: 'Transaction History' })");
    expect(source).toContain("t('discrepancy.cards.relatedTransactions', { defaultValue: 'Related Transactions' })");
    expect(source).toContain("t('discrepancy.fields.created', { defaultValue: 'Date' })");
    expect(source).toContain("t('discrepancy.fields.type', { defaultValue: 'Type' })");
    expect(source).toContain("t('discrepancy.fields.amount', { defaultValue: 'Amount' })");
    expect(source).toContain("t('discrepancy.fields.balanceAfter', { defaultValue: 'Balance After' })");
    expect(source).toContain("t('discrepancy.fields.description', { defaultValue: 'Description' })");
  });

  it('T009: wires the credit tracking table headers and issue detail alerts through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/DiscrepancyDetail.tsx');

    expect(source).toContain("t('discrepancy.tabs.creditTrackingEntries', { defaultValue: 'Credit Tracking Entries' })");
    expect(source).toContain("t('discrepancy.cards.creditTrackingEntries', { defaultValue: 'Credit Tracking Entries' })");
    expect(source).toContain("t('discrepancy.fields.creditId', { defaultValue: 'Credit ID' })");
    expect(source).toContain("t('discrepancy.fields.remaining', { defaultValue: 'Remaining' })");
    expect(source).toContain("t('discrepancy.fields.expiration', { defaultValue: 'Expiration' })");
    expect(source).toContain("t('discrepancy.status.expired', { defaultValue: 'Expired' })");
    expect(source).toContain("t('discrepancy.status.active', { defaultValue: 'Active' })");
    expect(source).toContain("t('discrepancy.tabs.issueDetails', { defaultValue: 'Issue Details' })");
    expect(source).toContain("t('discrepancy.issueTypes.missingCreditTrackingEntry', { defaultValue: 'Missing Credit Tracking Entry' })");
    expect(source).toContain("t('discrepancy.issueTypes.inconsistentCreditRemainingAmount', { defaultValue: 'Inconsistent Credit Remaining Amount' })");
    expect(source).toContain("t('discrepancy.recommendedFix.title', { defaultValue: 'Recommended Fix' })");
  });

  it('T010: wires the resolution dialog labels and empty/error states through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/DiscrepancyDetail.tsx');

    expect(source).toContain("t('discrepancy.title', { defaultValue: 'Resolve Credit Discrepancy' })");
    expect(source).toContain("t('discrepancy.cards.discrepancyDetails', { defaultValue: 'Discrepancy Details' })");
    expect(source).toContain("t('discrepancy.cards.balanceComparison', { defaultValue: 'Balance Comparison' })");
    expect(source).toContain("t('discrepancy.fields.expectedBalance', { defaultValue: 'Expected Balance' })");
    expect(source).toContain("t('discrepancy.fields.actualBalance', { defaultValue: 'Actual Balance' })");
    expect(source).toContain("t('discrepancy.fields.difference', { defaultValue: 'Difference' })");
    expect(source).toContain("t('discrepancy.fields.resolutionNotes', { defaultValue: 'Resolution Notes' })");
    expect(source).toContain("t('discrepancy.resolutionDialog.notesPlaceholder', { defaultValue: 'Explain the reason for this correction...' })");
    expect(source).toContain("t('discrepancy.resolutionDialog.confirmButton', { defaultValue: 'Confirm Resolution' })");
    expect(source).toContain("t('discrepancy.empty.transactions', { defaultValue: 'No related transactions found.' })");
    expect(source).toContain("t('discrepancy.empty.creditTrackingEntries', { defaultValue: 'No credit tracking entries found.' })");
    expect(source).toContain("t('discrepancy.empty.issueDetails', { defaultValue: 'No issue details available.' })");
    expect(source).toContain("t('discrepancy.empty.noNotesProvided', { defaultValue: 'No notes provided' })");
    expect(source).toContain("t('discrepancy.errors.unknown', { defaultValue: 'An unknown error occurred' })");
  });

  it('T011: keeps the discrepancy detail shell backed by xx pseudo-locale keys instead of raw English', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    const pseudoKeys = [
      'discrepancy.backToReconciliation',
      'discrepancy.status.open',
      'discrepancy.status.inReview',
      'discrepancy.status.resolved',
      'discrepancy.tabs.transactionHistory',
      'discrepancy.tabs.creditTrackingEntries',
      'discrepancy.tabs.issueDetails',
      'discrepancy.cards.discrepancyDetails',
      'discrepancy.cards.balanceComparison',
      'discrepancy.fields.expectedBalance',
      'discrepancy.fields.actualBalance',
      'discrepancy.fields.difference',
      'discrepancy.resolutionDialog.confirmButton',
      'discrepancy.recommendedFix.title',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});

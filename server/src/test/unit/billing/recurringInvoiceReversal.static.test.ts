import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const billingCycleActionsPath = path.join(
  repoRoot,
  'packages/billing/src/actions/billingCycleActions.ts',
);
const invoiceModificationPath = path.join(
  repoRoot,
  'packages/billing/src/actions/invoiceModification.ts',
);

describe('recurring invoice reversal flow', () => {
  it('T033/T034/T085: recurring reverse/delete flows stay invoice-first and repair canonical service-period linkage without billing-cycle cleanup branches', () => {
    const billingCycleActionsSource = fs.readFileSync(billingCycleActionsPath, 'utf8');
    const invoiceModificationSource = fs.readFileSync(invoiceModificationPath, 'utf8');

    const reverseSection = billingCycleActionsSource
      .split('export const reverseRecurringInvoice')[1]
      .split('export const hardDeleteRecurringInvoice')[0];
    const deleteSection = billingCycleActionsSource
      .split('export const hardDeleteRecurringInvoice')[1]
      .split('export const getInvoicedBillingCycles')[0];

    expect(reverseSection).toContain('await hardDeleteInvoice(params.invoiceId);');
    expect(reverseSection).not.toContain('params.billingCycleId');
    expect(deleteSection).toContain('await hardDeleteInvoice(params.invoiceId);');
    expect(deleteSection).not.toContain('params.billingCycleId');
    expect(invoiceModificationSource).toContain('await releaseRecurringServicePeriodInvoiceLinkageForInvoice(');
    expect(invoiceModificationSource).toContain("lifecycle_state: 'locked'");
    expect(invoiceModificationSource).toContain('invoice_id: null');
    expect(invoiceModificationSource).toContain('invoice_charge_id: null');
    expect(invoiceModificationSource).toContain('invoice_linked_at: null');
  });
});

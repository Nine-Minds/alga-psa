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
  it('keeps recurring reverse/delete invoice-first and repairs canonical service-period linkage in invoice deletion', () => {
    const billingCycleActionsSource = fs.readFileSync(billingCycleActionsPath, 'utf8');
    const invoiceModificationSource = fs.readFileSync(invoiceModificationPath, 'utf8');

    const reverseStart = billingCycleActionsSource.indexOf('export const reverseRecurringInvoice');
    const reverseHardDeleteIndex = billingCycleActionsSource.indexOf('await hardDeleteInvoice(params.invoiceId);', reverseStart);
    const reverseBridgeIndex = billingCycleActionsSource.indexOf('if (params.billingCycleId)', reverseStart);

    const deleteStart = billingCycleActionsSource.indexOf('export const hardDeleteRecurringInvoice');
    const deleteHardDeleteIndex = billingCycleActionsSource.indexOf('await hardDeleteInvoice(params.invoiceId);', deleteStart);
    const deleteBridgeIndex = billingCycleActionsSource.indexOf('if (params.billingCycleId)', deleteStart);

    expect(reverseHardDeleteIndex).toBeGreaterThan(reverseStart);
    expect(reverseBridgeIndex).toBeGreaterThan(reverseHardDeleteIndex);
    expect(deleteHardDeleteIndex).toBeGreaterThan(deleteStart);
    expect(deleteBridgeIndex).toBeGreaterThan(deleteHardDeleteIndex);
    expect(invoiceModificationSource).toContain('await releaseRecurringServicePeriodInvoiceLinkageForInvoice(');
    expect(invoiceModificationSource).toContain("lifecycle_state: 'locked'");
    expect(invoiceModificationSource).toContain('invoice_id: null');
    expect(invoiceModificationSource).toContain('invoice_charge_id: null');
    expect(invoiceModificationSource).toContain('invoice_linked_at: null');
  });
});
